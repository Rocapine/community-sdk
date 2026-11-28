-- community-sdk messaging/005_review_fixes.sql (schema v1)
-- Review fixes to the messaging RPCs of messaging/001 (same signatures, grants kept):
--  - send_message: a group that isn't visible (pending, hidden, deleted) takes no new
--    message ('not_found'), except from the creator of a group still pending review.
--    The groups table is read only when the groups module is installed;
--  - edit_message: edits share the sender's per-minute budget (`ratePerMinute`): the
--    author's sends plus edits of the last 60 s, under the same per-author lock;
--  - delete_message: a banned creator no longer deletes other members' messages.
-- Requires messaging/001. Idempotent.
-- With the dms module, the dms migrations own later versions of send_message: a new
-- migration that replaces it must keep their DM rules (visible_from, blocks, the first
-- message's checks), then re-run supabase-tests/dms.sql.

-- Edits of the last minute, for edit_message's count.
create index if not exists message_versions_replaced_idx
  on public.message_versions (replaced_at);

create or replace function public.send_message(
  p_conversation uuid,
  p_body text,
  p_reply_to uuid default null,
  p_image_path text default null,
  p_attachment_type text default null,
  p_attachment_id text default null
)
returns public.messages
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_kind text;
  v_mode text := coalesce(public.messaging_setting('moderation') #>> '{}', 'post');
  v_group_status text;
  v_group_creator uuid;
  v_msg public.messages;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select c.kind into v_kind
  from conversations c
  join conversation_members m on m.conversation_id = c.id
  where c.id = p_conversation and m.user_id = v_uid and m.state = 'active';
  if not found then
    raise exception 'not_a_member';
  end if;
  -- A hidden or deleted group is closed; a pending one only to its creator (who may
  -- write while it is under review).
  if v_kind = 'group' and to_regclass('public.groups') is not null then
    execute 'select status, created_by from public.groups where conversation_id = $1'
      into v_group_status, v_group_creator using p_conversation;
    if v_group_status is not null and v_group_status <> 'visible'
       and not (v_group_status = 'pending' and v_group_creator = v_uid) then
      raise exception 'not_found';
    end if;
  end if;
  if public.current_user_banned() then
    raise exception 'banned';
  end if;
  if v_kind = 'dm' and exists (
    select 1 from conversation_members m
    where m.conversation_id = p_conversation and m.user_id <> v_uid and m.state <> 'removed'
      and m.user_id = any (public.blocked_member_ids())
  ) then
    raise exception 'blocked';
  end if;
  if (p_attachment_type is null) <> (p_attachment_id is null) then
    raise exception 'invalid_attachment';
  end if;
  if v_body is null and p_image_path is null and p_attachment_type is null then
    raise exception 'empty_message';
  end if;
  if char_length(v_body) > coalesce((public.messaging_setting('maxLength'))::int, 2000) then
    raise exception 'message_too_long';
  end if;
  if p_image_path is not null
     and p_image_path !~ ('^' || p_conversation || '/' || v_uid || '/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$') then
    raise exception 'invalid_image_path';
  end if;
  if p_reply_to is not null and not exists (
    select 1 from messages where id = p_reply_to and conversation_id = p_conversation
  ) then
    raise exception 'invalid_reply';
  end if;
  -- One sender at a time per author, so parallel calls can't all pass the count.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if (select count(*) from messages
      where author_id = v_uid and created_at > now() - interval '60 seconds')
     >= coalesce((public.messaging_setting('ratePerMinute'))::int, 20) then
    raise exception 'rate_limited';
  end if;

  insert into messages (conversation_id, author_id, body, image_path, attachment_type,
                        attachment_id, reply_to_id, status, moderated_at)
  values (p_conversation, v_uid, v_body, p_image_path, p_attachment_type, p_attachment_id,
          p_reply_to,
          case when p_image_path is not null or v_mode = 'pre' then 'pending' else 'visible' end,
          case when p_image_path is null and v_mode = 'reportOnly' then now() end)
  returning * into v_msg;

  update conversations set last_message_at = v_msg.created_at where id = p_conversation;
  update conversation_members set last_read_at = now()
  where conversation_id = p_conversation and user_id = v_uid;
  return v_msg;
end;
$$;

-- A hidden message can't be edited: an edit would put it back in front of readers.
-- Edits count with sends against ratePerMinute: each one re-runs moderation.
create or replace function public.edit_message(p_message uuid, p_body text)
returns public.messages
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_mode text := coalesce(public.messaging_setting('moderation') #>> '{}', 'post');
  v_old public.messages;
  v_msg public.messages;
begin
  select * into v_old from messages where id = p_message and author_id = v_uid for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_old.status not in ('pending', 'visible') then
    raise exception 'not_editable';
  end if;
  if not exists (
    select 1 from conversation_members
    where conversation_id = v_old.conversation_id and user_id = v_uid and state = 'active'
  ) then
    raise exception 'not_a_member';
  end if;
  if public.current_user_banned() then
    raise exception 'banned';
  end if;
  if v_body is null and v_old.image_path is null and v_old.attachment_type is null then
    raise exception 'empty_message';
  end if;
  if char_length(v_body) > coalesce((public.messaging_setting('maxLength'))::int, 2000) then
    raise exception 'message_too_long';
  end if;
  -- send_message's lock: sends and edits of one author are counted one at a time.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if (select count(*) from messages
      where author_id = v_uid and created_at > now() - interval '60 seconds')
     + (select count(*) from message_versions v
        join messages m on m.id = v.message_id
        where v.replaced_at > now() - interval '60 seconds' and m.author_id = v_uid)
     >= coalesce((public.messaging_setting('ratePerMinute'))::int, 20) then
    raise exception 'rate_limited';
  end if;

  insert into message_versions (message_id, body, image_path)
  values (v_old.id, v_old.body, v_old.image_path);
  delete from message_translations where message_id = v_old.id;
  update messages set
    body = v_body,
    edited_at = now(),
    lang = null,
    moderation_reason = null,
    status = case when image_path is not null or v_mode = 'pre' then 'pending' else 'visible' end,
    moderated_at = case when image_path is null and v_mode = 'reportOnly' then now() end
  where id = v_old.id
  returning * into v_msg;
  return v_msg;
end;
$$;

-- The author deletes (placeholder "Message deleted"); an admin account
-- (profiles.is_admin) hides (status hidden, the row kept for the dashboard); a group's
-- creator who isn't banned deletes others' messages, never an admin account's
-- ("Deleted by the group's creator").
create or replace function public.delete_message(p_message uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.messages;
  v_kind text;
  v_by text;
begin
  select * into v_msg from messages where id = p_message for update;
  if not found then
    raise exception 'not_found';
  end if;
  select kind into v_kind from conversations where id = v_msg.conversation_id;

  if v_msg.author_id = v_uid then
    v_by := 'author';
  elsif public.current_user_admin() then
    update messages set status = 'hidden', deleted_by = 'admin' where id = p_message;
    return;
  elsif v_kind = 'group'
    and not public.current_user_banned()
    and exists (
      select 1 from conversation_members
      where conversation_id = v_msg.conversation_id and user_id = v_uid
        and role = 'creator' and state = 'active'
    )
    and not coalesce((select is_admin from profiles where id = v_msg.author_id), false) then
    v_by := 'creator';
  else
    raise exception 'forbidden';
  end if;

  -- Already gone for everyone else: nothing to replace with a placeholder.
  if v_msg.status in ('deleted', 'hidden') then
    return;
  end if;
  insert into message_versions (message_id, body, image_path)
  values (v_msg.id, v_msg.body, v_msg.image_path);
  delete from message_translations where message_id = v_msg.id;
  update messages set
    body = null, image_path = null, attachment_type = null, attachment_id = null,
    status = 'deleted', deleted_by = v_by
  where id = p_message;
end;
$$;
