-- community-sdk dms/006_first_message.sql
-- Final-review fixes on dms/001–005:
-- - A DM is created for its recipient by the first message, not by "Message". start_dm
--   creates the conversation and the caller's own row only (their screen works); the
--   recipient's row comes with the first send_message, after a new DM's checks (their
--   switch, the account rule, a recent decline, blocks, and in requests mode the day's
--   budget): 'request' in requests mode, else 'active'. Until then the recipient has
--   nothing: no row, no list entry, no request, and turning DMs off still refuses the
--   DM. Both opened it without writing (a mutual start): both rows are 'active', the
--   first message runs no request check (each chose to write to the other), and nobody
--   is told of an acceptance. start_dm accepts a pending request (dm_accept: the
--   center item and the broadcast) only when its sender wrote. A DM with messages
--   keeps working after the recipient turns DMs off (`has_dm` in profile_dm_flags and
--   the picker follow the same rule: the other member has a row). Rows left by the old
--   start_dm (a recipient's row nobody wrote to) are deleted.
-- - dm_peers takes the peer from dm_pairs, so a DM the caller opened alone has one.
-- - merge_messaging (dms/001's) moves over a row that exists only in the dropped DM.
-- - The author of a DM message can't read its cached translations: one would tell them
--   the recipient read it (a request, or read receipts off).
-- Requires messaging/001–006 and dms/001–005. Idempotent.

-- ============ ROWS NOBODY WROTE TO ============
-- The old start_dm made the recipient's row at once: a request whose sender never
-- wrote, or an active row in a DM without any message that its member never opened.
delete from public.conversation_members cm
using public.conversations c
where c.id = cm.conversation_id and c.kind = 'dm'
  and ((cm.state = 'request'
        and not exists (select 1 from public.messages m
                        where m.conversation_id = cm.conversation_id and m.author_id <> cm.user_id
                          and m.created_at >= coalesce(cm.visible_from, '-infinity')))
    or (cm.state = 'active' and cm.last_read_at is null
        and not exists (select 1 from public.messages m where m.conversation_id = cm.conversation_id)));

-- ============ START ============
-- Gets or creates the caller's DM with p_recipient, with the caller's row only. In an
-- existing DM: the caller gets a row if the other member opened it first; a request the
-- other member wrote is accepted; a DM the caller declined reopens from now on. While
-- nothing was written to p_recipient (no row of theirs), it refuses what the first
-- message would: their switch, the account rule (both sides), a recent decline and,
-- in requests mode, a spent day's budget (dm_request_refusal reads it, the first message
-- spends it).
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
    if exists (select 1 from conversation_members
               where conversation_id = v_conv and user_id = p_recipient) then
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
-- dms/005's, plus the DM's first message to the other member (no row of theirs yet):
-- a new DM's checks and, in requests mode, one from the day's budget, or the message
-- is refused; then their row, joined just before it so it counts as unread and pushes.
-- A block is checked against the pair, row or not.
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
    if v_peer_state is null then
      v_refusal := public.dm_request_refusal(v_uid, v_peer);
      if v_refusal is null then
        v_refusal := public.dm_log_request(v_uid, v_peer);
      end if;
      if v_refusal is not null then
        raise exception '%', v_refusal;
      end if;
      insert into conversation_members (conversation_id, user_id, state, joined_at)
      values (p_conversation, v_peer,
              case when coalesce(public.messaging_setting('dmsFirstMessage') #>> '{}', 'direct') = 'requests'
                then 'request' else 'active' end,
              now() - interval '1 millisecond');
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

-- ============ LISTS ============
-- dms/001's, with the peer from dm_pairs: a DM the caller opened alone has one too.
-- The UI leaves a DM without any message out of the list it shows.
create or replace function public.dm_peers()
returns table (conversation_id uuid, peer_id uuid, my_state text)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids)
  select cm.conversation_id, p.peer, cm.state
  from conversation_members cm
  join dm_pairs d on d.conversation_id = cm.conversation_id
  cross join lateral (
    select case when d.user_a = cm.user_id then d.user_b else d.user_a end as peer
  ) p
  cross join b
  where cm.user_id = auth.uid() and cm.state in ('active', 'request')
    and not (p.peer = any (b.ids));
$$;

-- dms/003's, with `has_dm` only once the member has a row in our DM (a DM written to,
-- or one they opened too): the DM that keeps working after they turn DMs off.
create or replace function public.profile_dm_flags(p_ids uuid[])
returns table (user_id uuid, accepts_dms boolean, has_account boolean, has_dm boolean)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids)
  select p.id, p.accepts_dms, public.has_account_link(p.id),
    exists (select 1 from dm_pairs d
            join conversation_members cm on cm.conversation_id = d.conversation_id and cm.user_id = p.id
            where d.user_a = least(p.id, auth.uid()) and d.user_b = greatest(p.id, auth.uid()))
  from profiles p
  cross join b
  where auth.uid() is not null
    and p.id = any ((p_ids)[1:200])
    and not p.is_banned
    and not (p.id = any (b.ids));
$$;

-- dms/003's, with the same existing-DM rule as has_dm.
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
                 where d.user_a = least(p.id, auth.uid()) and d.user_b = greatest(p.id, auth.uid()))
         or (p.accepts_dms
             and (not acct.required
                  or (public.has_account_link(p.id) and public.has_account_link(auth.uid())))))
  order by p.username, p.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- ============ PROFILE MERGE ============
-- dms/001's, plus: a member's row that exists only in the dropped DM (one side had only
-- opened it, or it was never written to them there) moves to the kept one.
create or replace function public.merge_messaging(p_main uuid, p_other uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_convs uuid[];
  v_main_conv uuid;
  v_other_conv uuid;
  v_keep uuid;
  v_drop uuid;
begin
  delete from conversations where id in (
    select conversation_id from dm_pairs
    where user_a = least(p_main, p_other) and user_b = greatest(p_main, p_other));
  for v_other_conv, v_main_conv in
    select po.conversation_id, pm.conversation_id
    from dm_pairs po
    join dm_pairs pm
      on pm.user_a = least(p_main, case when po.user_a = p_other then po.user_b else po.user_a end)
     and pm.user_b = greatest(p_main, case when po.user_a = p_other then po.user_b else po.user_a end)
    where p_other in (po.user_a, po.user_b)
  loop
    select id into v_keep from conversations where id in (v_main_conv, v_other_conv)
    order by created_at, id limit 1;
    v_drop := case when v_keep = v_main_conv then v_other_conv else v_main_conv end;
    -- Never seen: before the row's visible_from, or anything while it is declined (a
    -- re-request a new DM's checks refused leaves a past visible_from). A report on
    -- one keeps the body in its details (when empty); message_id goes null.
    update reports r set details = m.body
    from messages m
    join conversation_members cm on cm.conversation_id = m.conversation_id
    where r.message_id = m.id and m.conversation_id in (v_keep, v_drop)
      and cm.user_id <> m.author_id
      and (m.created_at < cm.visible_from or cm.state = 'declined')
      and coalesce(r.details, '') = '';
    delete from messages m using conversation_members cm
    where m.conversation_id in (v_keep, v_drop) and cm.conversation_id = m.conversation_id
      and cm.user_id <> m.author_id
      and (m.created_at < cm.visible_from or cm.state = 'declined');
    update conversation_members k set
      state = case when public.dm_state_rank(d.state) < public.dm_state_rank(k.state)
                   then d.state else k.state end,
      visible_from = case when public.dm_state_rank(d.state) < public.dm_state_rank(k.state)
                          then d.visible_from else k.visible_from end,
      joined_at = least(k.joined_at, d.joined_at),
      last_read_at = greatest(k.last_read_at, d.last_read_at),
      notify = k.notify or d.notify
    from conversation_members d
    where k.conversation_id = v_keep and d.conversation_id = v_drop
      and coalesce(nullif(k.user_id, p_other), p_main) = coalesce(nullif(d.user_id, p_other), p_main);
    update conversation_members d set conversation_id = v_keep
    where d.conversation_id = v_drop
      and not exists (
        select 1 from conversation_members k
        where k.conversation_id = v_keep
          and coalesce(nullif(k.user_id, p_other), p_main) = coalesce(nullif(d.user_id, p_other), p_main));
    update conversation_members set visible_from = null
    where conversation_id = v_keep and state = 'active' and visible_from > now();
    update messages set conversation_id = v_keep where conversation_id = v_drop;
    update conversations set last_message_at = (
      select max(created_at) from messages where conversation_id = v_keep
    ) where id = v_keep;
    if exists (select 1 from pg_attribute
               where attrelid = to_regclass('public.notifications') and attname = 'conversation_id'
                 and not attisdropped) then
      execute 'update public.notifications set conversation_id = $1 where conversation_id = $2'
        using v_keep, v_drop;
    end if;
    delete from conversations where id = v_drop;
  end loop;
  update dm_pairs set
    user_a = least(coalesce(nullif(user_a, p_other), p_main), coalesce(nullif(user_b, p_other), p_main)),
    user_b = greatest(coalesce(nullif(user_a, p_other), p_main), coalesce(nullif(user_b, p_other), p_main))
  where p_other in (user_a, user_b);

  delete from dm_declines
  where (sender_id = p_main and recipient_id = p_other) or (sender_id = p_other and recipient_id = p_main);
  update dm_declines m set until = greatest(m.until, o.until)
  from dm_declines o
  where o.sender_id = p_other and m.sender_id = p_main and m.recipient_id = o.recipient_id;
  delete from dm_declines o where o.sender_id = p_other
    and exists (select 1 from dm_declines m where m.sender_id = p_main and m.recipient_id = o.recipient_id);
  update dm_declines set sender_id = p_main where sender_id = p_other;
  update dm_declines m set until = greatest(m.until, o.until)
  from dm_declines o
  where o.recipient_id = p_other and m.recipient_id = p_main and m.sender_id = o.sender_id;
  delete from dm_declines o where o.recipient_id = p_other
    and exists (select 1 from dm_declines m where m.recipient_id = p_main and m.sender_id = o.sender_id);
  update dm_declines set recipient_id = p_main where recipient_id = p_other;
  delete from dm_request_log
  where (sender_id = p_main and recipient_id = p_other) or (sender_id = p_other and recipient_id = p_main);
  update dm_request_log set sender_id = p_main where sender_id = p_other;
  update dm_request_log set recipient_id = p_main where recipient_id = p_other;

  -- messaging/001's body from here.
  select coalesce(array_agg(conversation_id), '{}') into v_convs
  from conversation_members where user_id = p_other;

  update conversation_members m set
    joined_at = least(m.joined_at, o.joined_at),
    notify = m.notify or o.notify,
    role = case when 'creator' in (m.role, o.role) then 'creator' else m.role end
  from conversation_members o
  where m.user_id = p_main and o.user_id = p_other and o.conversation_id = m.conversation_id;
  delete from conversation_members o where o.user_id = p_other
    and exists (select 1 from conversation_members m where m.conversation_id = o.conversation_id and m.user_id = p_main);
  update conversation_members set user_id = p_main where user_id = p_other;
  update conversation_members set removed_by = p_main where removed_by = p_other;

  update messages set author_id = p_main where author_id = p_other;

  with dup as (
    delete from message_likes o where o.user_id = p_other
      and exists (select 1 from message_likes m where m.message_id = o.message_id and m.user_id = p_main)
    returning o.message_id
  )
  update messages set like_count = greatest(like_count - 1, 0) where id in (select message_id from dup);
  update message_likes set user_id = p_main where user_id = p_other;

  if to_regclass('public.groups') is not null then
    update groups set created_by = p_main where created_by = p_other;
    delete from group_removals o where o.user_id = p_other
      and exists (select 1 from group_removals m where m.group_id = o.group_id and m.user_id = p_main);
    update group_removals set user_id = p_main where user_id = p_other;
    update group_removals set removed_by = p_main where removed_by = p_other;
    update groups g set member_count = (
      select count(*) from conversation_members cm where cm.conversation_id = g.conversation_id and cm.state = 'active'
    ) where g.conversation_id = any (v_convs);
  end if;
end;
$$;

-- ============ READ STATE ============
-- messaging/001's, except that the author of a DM message doesn't read its translations:
-- a cached one would tell them the other member read it (a request, receipts off).
drop policy if exists "read translations of readable messages" on public.message_translations;
create policy "read translations of readable messages" on public.message_translations
  for select to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_translations.message_id
      and not (m.author_id = (select auth.uid())
               and exists (select 1 from public.conversations c
                           where c.id = m.conversation_id and c.kind = 'dm'))));

revoke execute on function public.start_dm(uuid) from public, anon;
revoke execute on function public.send_message(uuid, text, uuid, text, text, text) from public, anon;
revoke execute on function public.dm_peers() from public, anon;
revoke execute on function public.profile_dm_flags(uuid[]) from public, anon;
revoke execute on function public.search_dm_members(text, int) from public, anon;
revoke execute on function public.merge_messaging(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_dm(uuid) to authenticated;
grant execute on function public.send_message(uuid, text, uuid, text, text, text) to authenticated;
grant execute on function public.dm_peers() to authenticated;
grant execute on function public.profile_dm_flags(uuid[]) to authenticated;
grant execute on function public.search_dm_members(text, int) to authenticated;
