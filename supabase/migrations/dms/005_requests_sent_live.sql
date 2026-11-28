-- community-sdk dms/005_requests_sent_live.sql
-- Device-verification fixes on dms/001–004:
-- - A request counts against `dmsRequestsPerDay` when it is sent, not when "Message" is
--   tapped. dm_request_refusal (dms/001's) no longer logs: start_dm still refuses early
--   once the day's budget is spent, but opening a DM without writing costs nothing. The
--   new dm_log_request takes one from the budget (requests mode only), and send_message
--   (dms/001's) calls both on a request's first message, raising the refusal (the
--   message isn't stored), and on the request after a decline's cooldown, keeping that
--   message silent on a refusal (ruling D4).
-- - Live lists: each member listens to a private channel `dms:<their id>`, which only
--   they can join and nobody can send on. The server broadcasts `changed` there, with
--   the conversation id only, when a DM message becomes visible to that member (a new
--   DM, a new request, a later message) and when their request is accepted, so the
--   Requests row, the conversation list and the badge refetch. Nothing is sent for what
--   the member may not see: a declined request, a message before their visible_from, a
--   blocked pair, a pending or hidden message. A decline is never broadcast to the
--   sender. No-op where realtime.send doesn't exist.
-- Requires messaging/001–006 and dms/001. Idempotent.

-- ============ REQUEST BUDGET ============
-- dms/001's, without the log: why p_sender may not start a request to p_recipient now
-- (null: they may). The budget is only read here; dm_log_request spends it.
create or replace function public.dm_request_refusal(p_sender uuid, p_recipient uuid)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_recipient public.profiles;
begin
  select * into v_recipient from profiles where id = p_recipient;
  if not found or v_recipient.is_banned then
    return 'not_found';
  end if;
  if not v_recipient.accepts_dms then
    return 'dms_off';
  end if;
  if coalesce((public.messaging_setting('dmsRequireAccount'))::boolean, false)
     and not (public.has_account_link(p_sender) and public.has_account_link(p_recipient)) then
    return 'account_required';
  end if;
  if exists (select 1 from dm_declines
             where sender_id = p_sender and recipient_id = p_recipient and until > now()) then
    return 'declined_recently';
  end if;
  if coalesce(public.messaging_setting('dmsFirstMessage') #>> '{}', 'direct') = 'requests'
     and (select count(*) from dm_request_log
          where sender_id = p_sender and at > now() - interval '1 day')
         >= coalesce((public.messaging_setting('dmsRequestsPerDay'))::int, 5) then
    return 'too_many_requests';
  end if;
  return null;
end;
$$;

-- Logs a request p_sender sends p_recipient, in requests mode: 'too_many_requests'
-- (nothing logged) when the day's budget is spent, else null.
create or replace function public.dm_log_request(p_sender uuid, p_recipient uuid)
returns text
language plpgsql volatile security definer set search_path = public
as $$
begin
  if coalesce(public.messaging_setting('dmsFirstMessage') #>> '{}', 'direct') <> 'requests' then
    return null;
  end if;
  -- One count at a time per sender, so parallel requests can't all pass it.
  perform pg_advisory_xact_lock(hashtextextended('dm_requests:' || p_sender, 0));
  delete from dm_request_log where sender_id = p_sender and at <= now() - interval '1 day';
  if (select count(*) from dm_request_log where sender_id = p_sender)
     >= coalesce((public.messaging_setting('dmsRequestsPerDay'))::int, 5) then
    return 'too_many_requests';
  end if;
  insert into dm_request_log (sender_id, recipient_id) values (p_sender, p_recipient);
  return null;
end;
$$;

-- dms/001's, with the request counted on its first message (above).
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
  v_peer uuid;
  v_peer_state text;
  v_peer_from timestamptz;
  v_refusal text;
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
  -- Not to a message the caller may not see (before their visible_from).
  if p_reply_to is not null and not exists (
    select 1 from messages m
    where m.id = p_reply_to and m.conversation_id = p_conversation
      and m.created_at >= coalesce((select visible_from from conversation_members
                                    where conversation_id = p_conversation and user_id = v_uid),
                                   '-infinity')
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

  -- A request counts when it is sent. Its first message runs a new DM's checks and
  -- takes one from the day's budget, or is refused. After a decline's cooldown, the new
  -- request runs them too; one that fails leaves the recipient declined and the message
  -- silent, as during the cooldown (ruling D4).
  if v_kind = 'dm' then
    v_peer := public.dm_peer_of(p_conversation, v_uid);
    perform public.dm_lock_pair(v_uid, v_peer);
    select state, visible_from into v_peer_state, v_peer_from
    from conversation_members where conversation_id = p_conversation and user_id = v_peer;
    if v_peer_state = 'declined' then
      if public.dm_request_refusal(v_uid, v_peer) is null
         and public.dm_log_request(v_uid, v_peer) is null then
        update conversation_members set state = 'request', visible_from = now()
        where conversation_id = p_conversation and user_id = v_peer;
      end if;
    elsif v_peer_state = 'request' and not exists (
      select 1 from messages
      where conversation_id = p_conversation and author_id = v_uid
        and created_at >= coalesce(v_peer_from, '-infinity')
    ) then
      v_refusal := public.dm_request_refusal(v_uid, v_peer);
      if v_refusal is null then
        v_refusal := public.dm_log_request(v_uid, v_peer);
      end if;
      if v_refusal is not null then
        raise exception '%', v_refusal;
      end if;
    end if;
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



-- ============ LIVE LISTS ============
-- My own channel: only I join `dms:<my id>`. No insert policy matches it (messaging/001's
-- admits `conversation:` topics only), so only the server sends on it.
drop policy if exists "dms: members join their own channel" on realtime.messages;
create policy "dms: members join their own channel" on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'dms:' || (select auth.uid())::text);

-- A DM message that became visible: `changed` to the other member, when they may read it
-- (an active DM or a pending request, not before their visible_from, no block either way
-- but with an in-app admin, as in blocked_member_ids).
create or replace function public.dms_broadcast_message()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_peer uuid;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
     or (tg_op = 'UPDATE' and old.status = 'visible') then
    return null;
  end if;
  select case when d.user_a = new.author_id then d.user_b else d.user_a end into v_peer
  from public.dm_pairs d where d.conversation_id = new.conversation_id;
  if v_peer is not null
     and exists (
       select 1 from public.conversation_members cm
       where cm.conversation_id = new.conversation_id and cm.user_id = v_peer
         and cm.state in ('active', 'request')
         and new.created_at >= coalesce(cm.visible_from, '-infinity'))
     and not exists (
       select 1 from public.blocks b
       join public.profiles p on p.id = new.author_id and not p.is_admin
       where (b.blocker_id = v_peer and b.blocked_id = new.author_id)
          or (b.blocker_id = new.author_id and b.blocked_id = v_peer)) then
    perform realtime.send(
      jsonb_build_object('id', new.conversation_id),
      'changed',
      'dms:' || v_peer::text,
      true
    );
  end if;
  return null;
end;
$$;

drop trigger if exists dms_broadcast_message on public.messages;
create trigger dms_broadcast_message
  after insert or update of status on public.messages
  for each row
  when (new.status = 'visible')
  execute function public.dms_broadcast_message();

-- A request accepted: `changed` to its sender. A decline sends nothing (it is silent).
create or replace function public.dms_broadcast_accept()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_peer uuid;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return null;
  end if;
  select case when d.user_a = new.user_id then d.user_b else d.user_a end into v_peer
  from public.dm_pairs d where d.conversation_id = new.conversation_id;
  if v_peer is not null then
    perform realtime.send(
      jsonb_build_object('id', new.conversation_id),
      'changed',
      'dms:' || v_peer::text,
      true
    );
  end if;
  return null;
end;
$$;

drop trigger if exists dms_broadcast_accept on public.conversation_members;
create trigger dms_broadcast_accept
  after update of state on public.conversation_members
  for each row
  when (old.state = 'request' and new.state = 'active')
  execute function public.dms_broadcast_accept();

revoke all on function public.dms_broadcast_message() from public, anon, authenticated;
revoke all on function public.dms_broadcast_accept() from public, anon, authenticated;
revoke execute on function public.dm_request_refusal(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.dm_log_request(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.send_message(uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.send_message(uuid, text, uuid, text, text, text) to authenticated;
