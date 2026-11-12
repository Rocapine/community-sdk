-- community-sdk core/014_post_drafts.sql (schema v1)
-- Shared post drafts for the community dashboard (service role only): the team
-- writes a post under a team account, edits it together (`version` guards
-- concurrent saves), then publishes it with publish_post_draft. Publishing skips
-- moderation (the team wrote it), applies pin and "notify everyone", copies the
-- poll, attachment or image, deletes the draft and logs `publish_post`.
-- Clients never see this table. Fully idempotent.

create table if not exists public.post_drafts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  topic text,
  content text not null default '' check (char_length(content) <= 2000),
  image_path text,
  image_width int,
  image_height int,
  poll_options text[],
  attachment jsonb,
  notify boolean not null default false,
  pin boolean not null default false,
  publish_at timestamptz,
  version int not null default 1,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.post_drafts enable row level security;
-- No policy: readable only by the service role.
revoke all on table public.post_drafts from public, anon, authenticated;

alter table public.moderation_actions drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check check (action in
  ('hide','restore','confirm_hide','reject_report','ban','unban',
   'publish_post','create_team_account','update_team_account'));

-- Errors are raised with the code as the message (errcode P0001): draft_not_found,
-- draft_changed, not_a_team_account, author_banned, not_admin, invalid_content,
-- invalid_image, invalid_poll, invalid_attachment, one_extra_only. Columns of
-- optional modules (images, attachments) are only named when the draft uses
-- them, so a backend without those modules still publishes plain and poll drafts.
create or replace function public.publish_post_draft(p_draft_id uuid, p_version int, p_actor text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  d post_drafts;
  author profiles;
  new_id uuid;
  n int;
  i int;
begin
  select * into d from post_drafts where id = p_draft_id for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.version is distinct from p_version then raise exception 'draft_changed'; end if;

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
