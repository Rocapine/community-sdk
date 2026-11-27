-- community-sdk messaging/006_rate_and_lock_order.sql (schema v1)
-- Fixes to messaging/005's send_message and edit_message (same signatures, grants kept):
--  - send_message counts the author's sends plus edits of the last 60 s against
--    `ratePerMinute`, as edit_message already did: sends and edits share one budget;
--  - edit_message takes the per-author advisory lock before locking the message row,
--    the order send_message uses, so an edit and a concurrent reply to the edited
--    message can't deadlock.
-- Requires messaging/005. Idempotent.

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
  -- Sends and edits share one budget: the author's sends plus edits of the last 60 s.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if (select count(*) from messages
      where author_id = v_uid and created_at > now() - interval '60 seconds')
     + (select count(*) from message_versions v
        join messages m on m.id = v.message_id
        where v.replaced_at > now() - interval '60 seconds' and m.author_id = v_uid)
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
  -- send_message's per-author lock, taken BEFORE the message's row lock (send_message's
  -- order): a concurrent reply to this message (its key-share lock on the row, under
  -- the same advisory lock) can't deadlock with this edit.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
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
  -- Sends and edits of one author are counted one at a time (the lock above).
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
