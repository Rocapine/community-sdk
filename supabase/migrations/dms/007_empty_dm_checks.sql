-- community-sdk dms/007_empty_dm_checks.sql
-- Re-review fixes on dms/006:
-- - A DM nothing was written in is gated like a new DM on its first message, even when
--   both members opened it ("Message") without writing. send_message runs the new-DM
--   checks (the recipient's switch, the account rule, a recent decline, blocks, and in
--   requests mode the day's budget) while the other member has no row OR nothing was
--   ever written in the DM (`conversations.last_message_at` null: send_message sets it
--   on any message, whatever its status, and erasing messages later doesn't make the DM
--   new again). In requests mode the first message of a DM both opened makes the other
--   member's row a request. start_dm refuses those checks on opening a DM nothing was
--   written in, as for a new one. `has_dm` (profile_dm_flags) and the picker's
--   existing-DM rule need a DM written in: only that one outlives the other member's
--   switch (ruling D6).
-- - A block sends `changed` on the blocked member's `dms:<id>` only when they have a row
--   in the DM (dms/006 sent it to both whatever their row).
-- Requires dms/001–006. Idempotent.

-- ============ START ============
-- dms/006's, except that an existing DM nothing was written in runs a new DM's checks.
create or replace function public.start_dm(p_recipient uuid)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recipient public.profiles;
  v_conv uuid;
  v_state text;
  v_refusal text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_recipient is null or p_recipient = v_uid then
    raise exception 'invalid_recipient';
  end if;
  if public.current_user_banned() then
    raise exception 'banned';
  end if;
  select * into v_recipient from profiles where id = p_recipient;
  if not found or v_recipient.is_banned then
    raise exception 'not_found';
  end if;
  if p_recipient = any (public.blocked_member_ids()) then
    raise exception 'blocked';
  end if;

  perform public.dm_lock_pair(v_uid, p_recipient);
  select conversation_id into v_conv from dm_pairs
  where user_a = least(v_uid, p_recipient) and user_b = greatest(v_uid, p_recipient);
  if found then
    select state into v_state from conversation_members
    where conversation_id = v_conv and user_id = v_uid;
    if v_state is null then
      insert into conversation_members (conversation_id, user_id, state, last_read_at)
      values (v_conv, v_uid, 'active', now());
    elsif v_state = 'request' then
      if exists (select 1 from messages m
                 join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = v_uid
                 where m.conversation_id = v_conv and m.author_id = p_recipient
                   and m.created_at >= coalesce(cm.visible_from, '-infinity')) then
        perform public.dm_accept(v_conv, v_uid);
      end if;
    elsif v_state = 'declined' then
      update conversation_members set state = 'active', visible_from = now()
      where conversation_id = v_conv and user_id = v_uid;
      delete from dm_declines where sender_id = p_recipient and recipient_id = v_uid;
    end if;
    -- Written in: it opens whatever their switch says (ruling D6). Nothing written yet,
    -- whoever opened it: gated like a new DM.
    if (select last_message_at from conversations where id = v_conv) is not null then
      return v_conv;
    end if;
  end if;

  v_refusal := public.dm_request_refusal(v_uid, p_recipient);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;
  if v_conv is null then
    insert into conversations (kind) values ('dm') returning id into v_conv;
    insert into dm_pairs (conversation_id, user_a, user_b)
    values (v_conv, least(v_uid, p_recipient), greatest(v_uid, p_recipient));
    insert into conversation_members (conversation_id, user_id, state, last_read_at)
    values (v_conv, v_uid, 'active', now());
  end if;
  return v_conv;
end;
$$;


-- ============ FIRST MESSAGE ============
-- dms/006's, with a DM both opened but nobody wrote in gated like a new one.
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


-- ============ EXISTING DM ============
-- dms/006's: an existing DM is one written in.
create or replace function public.profile_dm_flags(p_ids uuid[])
returns table (user_id uuid, accepts_dms boolean, has_account boolean, has_dm boolean)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids)
  select p.id, p.accepts_dms, public.has_account_link(p.id),
    exists (select 1 from dm_pairs d
            join conversation_members cm on cm.conversation_id = d.conversation_id and cm.user_id = p.id
            where d.user_a = least(p.id, auth.uid()) and d.user_b = greatest(p.id, auth.uid())
              and exists (select 1 from conversations c
                          where c.id = d.conversation_id and c.last_message_at is not null))
  from profiles p
  cross join b
  where auth.uid() is not null
    and p.id = any ((p_ids)[1:200])
    and not p.is_banned
    and not (p.id = any (b.ids));
$$;


-- dms/006's, with the same rule.
create or replace function public.search_dm_members(p_query text, p_limit int default 20)
returns table (user_id uuid, username text, avatar_url text)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids),
  q as (select replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') as s),
  acct as (select coalesce((public.messaging_setting('dmsRequireAccount'))::boolean, false) as required)
  select p.id, p.username, p.avatar_url
  from profiles p
  cross join b
  cross join q
  cross join acct
  where auth.uid() is not null
    and q.s <> ''
    and p.id <> auth.uid()
    and not p.is_banned
    and not (p.id = any (b.ids))
    and p.username ilike '%' || q.s || '%'
    and (exists (select 1 from dm_pairs d
                 join conversation_members cm on cm.conversation_id = d.conversation_id and cm.user_id = p.id
                 where d.user_a = least(p.id, auth.uid()) and d.user_b = greatest(p.id, auth.uid())
                   and exists (select 1 from conversations c
                               where c.id = d.conversation_id and c.last_message_at is not null))
         or (p.accepts_dms
             and (not acct.required
                  or (public.has_account_link(p.id) and public.has_account_link(auth.uid())))))
  order by p.username, p.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;


-- ============ LIVE BLOCKS ============
-- dms/006's, the blocked member told only of a DM of theirs.
create or replace function public.dms_broadcast_block()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.blocks := coalesce(new, old);
  v_conversation uuid;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return null;
  end if;
  select d.conversation_id into v_conversation
  from public.dm_pairs d
  where d.user_a = least(v_row.blocker_id, v_row.blocked_id)
    and d.user_b = greatest(v_row.blocker_id, v_row.blocked_id);
  if v_conversation is not null then
    perform realtime.send(
      jsonb_build_object('id', v_conversation),
      'members',
      'conversation:' || v_conversation::text,
      true
    );
    perform realtime.send(jsonb_build_object('id', v_conversation), 'changed',
                          'dms:' || v_row.blocker_id::text, true);
    -- The blocked member only when the DM is theirs (a row): an opener's untouched DM
    -- tells its peer nothing.
    if exists (select 1 from public.conversation_members cm
               where cm.conversation_id = v_conversation and cm.user_id = v_row.blocked_id) then
      perform realtime.send(jsonb_build_object('id', v_conversation), 'changed',
                            'dms:' || v_row.blocked_id::text, true);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.dms_broadcast_block() from public, anon, authenticated;
revoke execute on function public.start_dm(uuid) from public, anon;
revoke execute on function public.send_message(uuid, text, uuid, text, text, text) from public, anon;
revoke execute on function public.profile_dm_flags(uuid[]) from public, anon;
revoke execute on function public.search_dm_members(text, int) from public, anon;
grant execute on function public.start_dm(uuid) to authenticated;
grant execute on function public.send_message(uuid, text, uuid, text, text, text) to authenticated;
grant execute on function public.profile_dm_flags(uuid[]) to authenticated;
grant execute on function public.search_dm_members(text, int) to authenticated;
