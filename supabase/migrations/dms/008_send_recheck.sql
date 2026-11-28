-- community-sdk dms/008_send_recheck.sql
-- Re-review fix on dms/007: send_message checks the caller's own DM row again once it
-- holds the pair lock. Two members sending the first message of a DM they both opened at
-- the same moment, in requests mode: the first turns the second's row into a request
-- while the second waits on the lock; the second then raised nothing, stored its message
-- in a request and stamped a read on it. Now it gets 'not_a_member' and stores nothing.
-- Requires dms/001–007. Idempotent.

-- dms/007's, plus the re-check under dm_lock_pair.
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
  if v_kind = 'dm' then
    v_peer := public.dm_peer_of(p_conversation, v_uid);
    if v_peer = any (public.blocked_member_ids()) then
      raise exception 'blocked';
    end if;
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

  -- The first message to the other member makes their row, once a new DM's checks
  -- pass. A request counts when it is sent: its first message takes one from the day's
  -- budget, or is refused. After a decline's cooldown, the new request runs them too;
  -- one that fails leaves the recipient declined and the message silent, as during the
  -- cooldown (ruling D4).
  if v_kind = 'dm' then
    perform public.dm_lock_pair(v_uid, v_peer);
    -- Checked again under the pair lock: the peer's first message, sent at the same
    -- moment, may have just turned the caller's row into a request to answer first.
    if not exists (select 1 from conversation_members
                   where conversation_id = p_conversation and user_id = v_uid and state = 'active') then
      raise exception 'not_a_member';
    end if;
    select state, visible_from into v_peer_state, v_peer_from
    from conversation_members where conversation_id = p_conversation and user_id = v_peer;
    if v_peer_state is null
       or (v_peer_state = 'active'
           and (select last_message_at from conversations where id = p_conversation) is null) then
      v_refusal := public.dm_request_refusal(v_uid, v_peer);
      if v_refusal is null then
        v_refusal := public.dm_log_request(v_uid, v_peer);
      end if;
      if v_refusal is not null then
        raise exception '%', v_refusal;
      end if;
      if v_peer_state is null then
        insert into conversation_members (conversation_id, user_id, state, joined_at)
        values (p_conversation, v_peer,
                case when coalesce(public.messaging_setting('dmsFirstMessage') #>> '{}', 'direct') = 'requests'
                  then 'request' else 'active' end,
                now() - interval '1 millisecond');
      else
        -- They opened it too, without writing: still a new DM for them (a request in
        -- requests mode), with nothing read in it.
        update conversation_members set
          state = case when coalesce(public.messaging_setting('dmsFirstMessage') #>> '{}', 'direct') = 'requests'
                    then 'request' else 'active' end,
          last_read_at = null,
          joined_at = least(joined_at, now() - interval '1 millisecond')
        where conversation_id = p_conversation and user_id = v_peer;
      end if;
    elsif v_peer_state = 'declined' then
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

revoke execute on function public.send_message(uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.send_message(uuid, text, uuid, text, text, text) to authenticated;
