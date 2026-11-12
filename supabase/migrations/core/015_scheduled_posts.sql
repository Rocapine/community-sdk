-- community-sdk core/015_scheduled_posts.sql (schema v1)
-- Scheduled posts for the community dashboard (service role only): a draft gets a
-- publish_at instant (publish_tz is the zone the team picked, for display only) and
-- schedule_post_draft sets or clears it. check_post_draft holds the validation that
-- publish_post_draft and the scheduler share. Requires core/014. Fully idempotent.

alter table public.post_drafts add column if not exists scheduled_by text;
alter table public.post_drafts add column if not exists publish_tz text;
alter table public.post_drafts add column if not exists publish_error text;
alter table public.post_drafts add column if not exists failed_at timestamptz;

create index if not exists post_drafts_due_idx on public.post_drafts (publish_at)
  where publish_at is not null and publish_error is null;

alter table public.moderation_actions drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check check (action in
  ('hide','restore','confirm_hide','reject_report','ban','unban',
   'publish_post','create_team_account','update_team_account','schedule_post'));

-- Raises the publish error codes (errcode P0001, code as message): not_a_team_account,
-- author_banned, not_admin, invalid_content, invalid_image, invalid_poll,
-- invalid_attachment, one_extra_only, invalid_topic. Callers are security definer; nobody else may run it.
create or replace function public.check_post_draft(d post_drafts)
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
end;
$$;

revoke execute on function public.check_post_draft(post_drafts) from public, anon, authenticated;

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

-- Sets (or, with a null p_publish_at, clears) the schedule of a draft and returns its new version.
-- Errors: draft_not_found, draft_changed, invalid_time (also a missing or unknown p_tz), plus the
-- check_post_draft codes. Unscheduling a draft with no time and no error does nothing.
create or replace function public.schedule_post_draft(
  p_draft_id uuid, p_version int, p_publish_at timestamptz, p_tz text, p_actor text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  d post_drafts;
begin
  select * into d from post_drafts where id = p_draft_id for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.version is distinct from p_version then raise exception 'draft_changed'; end if;

  if p_publish_at is not null then
    perform check_post_draft(d);
    if p_publish_at <= now() or p_publish_at > now() + interval '1 year 1 day' then
      raise exception 'invalid_time';
    end if;
    -- The zone is for display only, but it must be an IANA name (not a POSIX string the dashboard can't show).
    if p_tz is null or p_tz not in (select name from pg_timezone_names) then raise exception 'invalid_time'; end if;
  elsif d.publish_at is null and d.publish_error is null then
    return d.version; -- nothing to clear
  end if;

  update post_drafts set
    publish_at = p_publish_at,
    publish_tz = case when p_publish_at is not null then p_tz end,
    scheduled_by = case when p_publish_at is not null then p_actor end,
    publish_error = null,
    failed_at = null,
    version = version + 1,
    updated_by = p_actor,
    updated_at = now()
  where id = d.id;

  insert into moderation_actions (actor_email, action, target_user_id, note)
    values (p_actor, 'schedule_post', d.author_id,
            'draft ' || d.id || case when p_publish_at is not null
              then ' at ' || to_char(p_publish_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') else ' unscheduled' end);
  return d.version + 1;
end;
$$;

revoke execute on function public.schedule_post_draft(uuid, int, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.schedule_post_draft(uuid, int, timestamptz, text, text) to service_role;

-- Publishes the drafts whose time has come and returns how many went out. A draft more than
-- 30 minutes late is marked 'missed' instead; a draft that fails keeps its publish_at and
-- stores the error (the code for a P0001 error, else the message; cut to 200 characters),
-- so the next run skips it until the team reschedules it. Run by pg_cron every minute.
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
    where publish_at <= now() and publish_error is null
    order by publish_at for update skip locked
  loop
    if r.publish_at < now() - interval '30 minutes' then
      update post_drafts set publish_error = 'missed', failed_at = now() where id = r.id;
    else
      begin
        perform publish_post_draft(r.id, r.version, r.scheduled_by);
        n := n + 1;
      exception when others then
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
