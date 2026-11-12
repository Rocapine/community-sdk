-- community-sdk core/015_scheduled_posts.sql (schema v1)
-- Scheduled posts for the community dashboard (service role only): a draft gets a
-- publish_at instant (publish_tz is the zone the team picked, for display only) and
-- schedule_post_draft sets or clears it. A draft can carry a planned time without being armed:
-- armed means scheduled_by is not null, and only armed drafts are published by the cron.
-- Planning a time checks the time and the event window; arming validates the whole post.
-- check_post_draft holds the validation that publish_post_draft and the scheduler share.
-- Requires core/014. Fully idempotent.
-- topic_from / topic_until (nullable dates, until exclusive) hold the date window of an event
-- topic, which lives in the dashboard's config; the dashboard writes them with the topic.

alter table public.post_drafts add column if not exists scheduled_by text;
alter table public.post_drafts add column if not exists publish_tz text;
alter table public.post_drafts add column if not exists publish_error text;
alter table public.post_drafts add column if not exists failed_at timestamptz;
alter table public.post_drafts add column if not exists topic_from date;
alter table public.post_drafts add column if not exists topic_until date;

-- Only armed drafts are due; the predicate changed in the planned-time revision, so recreate it.
drop index if exists public.post_drafts_due_idx;
create index post_drafts_due_idx on public.post_drafts (publish_at)
  where publish_at is not null and publish_error is null and scheduled_by is not null;

alter table public.moderation_actions drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check check (action in
  ('hide','restore','confirm_hide','reject_report','ban','unban',
   'publish_post','create_team_account','update_team_account','schedule_post'));

-- The event-window part of the check, alone (it needs d.publish_tz): the local date the post goes
-- out in the draft's zone must fall in [topic_from, topic_until). A draft without a zone is guarded
-- by the dashboard only. Raises topic_closed.
create or replace function public.check_post_draft_window(d post_drafts, p_at timestamptz default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if d.publish_tz is not null and (d.topic_from is not null or d.topic_until is not null)
    and ((coalesce(p_at, now()) at time zone d.publish_tz)::date < d.topic_from
      or (coalesce(p_at, now()) at time zone d.publish_tz)::date >= d.topic_until) then
    raise exception 'topic_closed';
  end if;
end;
$$;

revoke execute on function public.check_post_draft_window(post_drafts, timestamptz) from public, anon, authenticated;

-- Raises the publish error codes (errcode P0001, code as message): not_a_team_account,
-- author_banned, not_admin, invalid_content, invalid_image, invalid_poll,
-- invalid_attachment, one_extra_only, invalid_topic, topic_closed. Callers are security definer; nobody else may run it.
-- Takes the instant the post goes out (default now) for the event window: publishing checks it at
-- that moment, scheduling checks the chosen time. Replaces the one-argument version of earlier runs.
drop function if exists public.check_post_draft(post_drafts);
create or replace function public.check_post_draft(d post_drafts, p_at timestamptz default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  author profiles;
  n int;
begin
  select * into author from profiles where id = d.author_id;
  if not found or not author.is_house then raise exception 'not_a_team_account'; end if;
  if author.is_banned then raise exception 'author_banned'; end if;
  if (d.pin or d.notify) and not author.is_admin then raise exception 'not_admin'; end if;

  -- Like posts_content_check: text is optional when there is an image.
  if char_length(d.content) > 2000 or (char_length(d.content) = 0 and d.image_path is null) then
    raise exception 'invalid_content';
  end if;
  -- Mirrors posts_image_check and posts_image_path_format (images/001). The image lives
  -- in the author's storage folder; the dashboard moves it when the author changes.
  if d.image_path is not null and (coalesce(d.image_width, 0) <= 0 or coalesce(d.image_height, 0) <= 0
    or d.image_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.jpg$'
    or split_part(d.image_path, '/', 1) <> d.author_id::text) then
    raise exception 'invalid_image';
  end if;
  n := coalesce(array_length(d.poll_options, 1), 0);
  if d.poll_options is not null and (n not between 2 and 4
    or exists (select 1 from unnest(d.poll_options) l where coalesce(char_length(l), 0) not between 1 and 60)) then
    raise exception 'invalid_poll';
  end if;
  -- Mirrors posts_attachment_check (attachments/001); coalesce because a null check result would pass.
  if d.attachment is not null and not coalesce(jsonb_typeof(d.attachment) = 'object'
    and d.attachment ? 'type' and d.attachment ? 'id'
    and jsonb_typeof(d.attachment -> 'type') = 'string' and jsonb_typeof(d.attachment -> 'id') = 'string'
    and octet_length(d.attachment::text) <= 512, false) then
    raise exception 'invalid_attachment';
  end if;
  if (d.image_path is not null)::int + (d.poll_options is not null)::int + (d.attachment is not null)::int > 1 then
    raise exception 'one_extra_only';
  end if;
  -- Topic rules live in the dashboard; here a draft only needs one, so the cron never posts without it.
  if d.topic is null then raise exception 'invalid_topic'; end if;
  perform check_post_draft_window(d, p_at);
end;
$$;

revoke execute on function public.check_post_draft(post_drafts, timestamptz) from public, anon, authenticated;

-- Same checks and codes as 014 (the validation now lives in check_post_draft, which also raises
-- invalid_topic: a draft needs a topic to go out).
create or replace function public.publish_post_draft(p_draft_id uuid, p_version int, p_actor text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  d post_drafts;
  new_id uuid;
  n int;
  i int;
begin
  select * into d from post_drafts where id = p_draft_id for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.version is distinct from p_version then raise exception 'draft_changed'; end if;

  perform check_post_draft(d);
  n := coalesce(array_length(d.poll_options, 1), 0);

  -- The image goes in the insert itself: an image-only post needs it to pass posts_content_check.
  if d.image_path is not null then
    insert into posts (author_id, topic, content, status, moderated_at, broadcast_requested, pinned_at,
                       image_path, image_width, image_height)
      values (d.author_id, d.topic, d.content, 'visible', now(), d.notify, case when d.pin then now() end,
              d.image_path, d.image_width, d.image_height)
      returning id into new_id;
  else
    insert into posts (author_id, topic, content, status, moderated_at, broadcast_requested, pinned_at)
      values (d.author_id, d.topic, d.content, 'visible', now(), d.notify, case when d.pin then now() end)
      returning id into new_id;
  end if;
  if d.attachment is not null then
    update posts set attachment = d.attachment where id = new_id;
  end if;
  for i in 1..n loop
    insert into poll_options (post_id, idx, label) values (new_id, i - 1, d.poll_options[i]);
  end loop;

  delete from post_drafts where id = d.id;
  insert into moderation_actions (actor_email, action, target_post_id, target_user_id)
    values (p_actor, 'publish_post', new_id, d.author_id);
  return new_id;
end;
$$;

revoke execute on function public.publish_post_draft(uuid, int, text) from public, anon, authenticated;
grant execute on function public.publish_post_draft(uuid, int, text) to service_role;

-- Plans, arms or clears the schedule of a draft and returns its new version. p_arm = false (with a
-- time) only plans it: the time, the zone and the event window are checked, not the post, and the
-- draft stays unarmed (scheduled_by null), so the cron leaves it alone; with the current time it
-- disarms a draft and keeps its time, with no check (the time may have passed). p_arm = true also validates the whole post (check_post_draft)
-- and arms it. A null p_publish_at clears the time and disarms. Logged (schedule_post) only when the
-- armed state changes or an armed draft's time changes.
-- Errors: draft_not_found, draft_changed, invalid_time (also a missing or unknown p_tz), plus the
-- check_post_draft codes (topic_closed for a time outside the event window). Clearing a draft with
-- no time, no error and no arming does nothing.
drop function if exists public.schedule_post_draft(uuid, int, timestamptz, text, text);
create or replace function public.schedule_post_draft(
  p_draft_id uuid, p_version int, p_publish_at timestamptz, p_tz text, p_actor text, p_arm boolean default true)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  d post_drafts;
  was_armed boolean;
  now_armed boolean := p_publish_at is not null and coalesce(p_arm, true);
  keep boolean; -- unschedule: disarm and keep the current time, which may be past, so nothing is re-checked
begin
  select * into d from post_drafts where id = p_draft_id for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.version is distinct from p_version then raise exception 'draft_changed'; end if;
  was_armed := d.scheduled_by is not null;
  keep := p_publish_at is not null and not coalesce(p_arm, true)
    and p_publish_at = d.publish_at and p_tz is not distinct from d.publish_tz;

  if keep then
    null;
  elsif p_publish_at is not null then
    if p_publish_at <= now() or p_publish_at > now() + interval '1 year 1 day' then
      raise exception 'invalid_time';
    end if;
    -- The zone is for display only, but it must be an IANA name (not a POSIX string the dashboard can't show).
    if p_tz is null or p_tz not in (select name from pg_timezone_names) then raise exception 'invalid_time'; end if;
    d.publish_tz := p_tz;
    if now_armed then
      perform check_post_draft(d, p_publish_at); -- the whole post, event window included
    else
      perform check_post_draft_window(d, p_publish_at);
    end if;
  elsif d.publish_at is null and d.publish_error is null and not was_armed then
    return d.version; -- nothing to clear
  end if;

  update post_drafts set
    publish_at = p_publish_at,
    publish_tz = case when p_publish_at is not null then p_tz end,
    scheduled_by = case when now_armed then p_actor end,
    publish_error = null,
    failed_at = null,
    version = version + 1,
    updated_by = p_actor,
    updated_at = now()
  where id = d.id;

  if was_armed <> now_armed or (now_armed and d.publish_at is distinct from p_publish_at) then
    insert into moderation_actions (actor_email, action, target_user_id, note)
      values (p_actor, 'schedule_post', d.author_id,
              'draft ' || d.id || case when now_armed
                then ' at ' || to_char(p_publish_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') else ' unscheduled' end);
  end if;
  return d.version + 1;
end;
$$;

revoke execute on function public.schedule_post_draft(uuid, int, timestamptz, text, text, boolean) from public, anon, authenticated;
grant execute on function public.schedule_post_draft(uuid, int, timestamptz, text, text, boolean) to service_role;

-- Publishes the armed drafts (scheduled_by set) whose time has come and returns how many went out. A draft more than
-- 30 minutes late is marked 'missed' instead; a draft that fails keeps its publish_at and
-- stores the error (the code for a P0001 error, else the message; cut to 200 characters),
-- so the next run skips it until the team reschedules it. A transient error (serialization
-- failure, deadlock, lock not available) leaves the draft untouched to be retried next run;
-- the 30-minute rule bounds the retries. Run by pg_cron every minute.
create or replace function public.publish_due_post_drafts()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id, version, scheduled_by, publish_at from post_drafts
    where publish_at <= now() and publish_error is null and scheduled_by is not null
    order by publish_at for update skip locked
  loop
    if r.publish_at < now() - interval '30 minutes' then
      update post_drafts set publish_error = 'missed', failed_at = now() where id = r.id;
    else
      begin
        perform publish_post_draft(r.id, r.version, r.scheduled_by);
        n := n + 1;
      exception
        when serialization_failure or deadlock_detected or lock_not_available then
          raise log 'publish_due_post_drafts: transient % on draft %', sqlstate, r.id;
        when others then
        update post_drafts set failed_at = now(),
          publish_error = left(sqlerrm, 200)
          where id = r.id;
      end;
    end if;
  end loop;
  return n;
end;
$$;

revoke execute on function public.publish_due_post_drafts() from public, anon, authenticated, service_role;

do $$
begin
  perform cron.schedule('post-drafts-publish', '* * * * *', $cron$ select public.publish_due_post_drafts(); $cron$);
exception when others then
  if sqlerrm like '%already exists%' then
    raise notice 'cron job post-drafts-publish already scheduled, skipping';
  else
    raise;
  end if;
end;
$$;
