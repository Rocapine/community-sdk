-- community-sdk dms/001_dms.sql (schema v1)
-- DMs module: direct messages between two members on the messaging core. A DM is a
-- `conversations` row of kind 'dm' with exactly two `conversation_members` rows and
-- one `dm_pairs` row (one DM per pair). With `dmsFirstMessage = 'requests'` the
-- recipient's row starts in state 'request': they read the request but leave no read
-- state until they accept. A decline is silent: the row goes to 'declined', the
-- sender keeps writing, and `visible_from` (the end of the cooldown) hides everything
-- written until then; the sender's first message after the cooldown makes a new
-- request showing only what follows (`visible_from` = that moment). A declined
-- request's messages are never shown to the recipient again: the read rules, the
-- conversation list and the unread counts all apply `visible_from`.
--
-- Replaces, each from its latest body: messaging_set_settings (DM keys),
-- can_read_conversation (DMs: the two members only, never across a block), the
-- messages read policy (visible_from), send_message (messaging/006: a new request
-- after the cooldown), list_conversations (groups/003 or messaging/001, whichever is
-- installed: visible_from), set_message_like (visible_from), unread_followed_messages
-- (DMs always followed, plus one per pending request), messaging_on_account_delete
-- (eraseDms) and merge_messaging (two DMs with one member become one). groups/003
-- recreates list_conversations without visible_from, so a host adding groups after
-- dms runs this file again once groups is in (`upgrade --add-modules groups` copies
-- it again). mark_conversation_read and unread_followed_messages_for need no
-- change (the first already skips a request, the second runs the function above).
--
-- dm_pairs, dm_declines and dm_request_log have no client access: the RPCs below read
-- and write them. Pushes and the inbox row on a new request are dms/002's.
-- Requires core and messaging/001–006. Idempotent.

-- ============ TABLES ============
-- The member-wide switch: off blocks new DMs only, existing ones keep working.
alter table public.profiles add column if not exists accepts_dms boolean not null default true;

-- For a DM recipient only: messages created before it are not theirs to read.
alter table public.conversation_members add column if not exists visible_from timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.conversation_members'::regclass
                   and conname = 'conversation_members_state_check'
                   and pg_get_constraintdef(oid) like '%declined%') then
    alter table public.conversation_members drop constraint if exists conversation_members_state_check;
    alter table public.conversation_members add constraint conversation_members_state_check
      check (state in ('active', 'request', 'removed', 'declined'));
  end if;
end $$;

create table if not exists public.dm_pairs (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index if not exists dm_pairs_user_b_idx on public.dm_pairs (user_b);

-- The sender can't start a new request to this recipient before `until`.
create table if not exists public.dm_declines (
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  until timestamptz not null,
  primary key (sender_id, recipient_id)
);

-- Requests started, for `dmsRequestsPerDay` (rows older than a day are dropped).
create table if not exists public.dm_request_log (
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists dm_request_log_sender_idx on public.dm_request_log (sender_id, at);

alter table public.dm_pairs enable row level security;
alter table public.dm_declines enable row level security;
alter table public.dm_request_log enable row level security;
revoke all on public.dm_pairs, public.dm_declines, public.dm_request_log
  from public, anon, authenticated;

-- ============ SETTINGS ============
-- Added with their defaults; values already set are kept.
insert into public.messaging_settings (id, settings) values (1, '{
  "dmsFirstMessage": "direct",
  "dmsReadReceipts": false,
  "dmsRequireAccount": false,
  "dmsRequestsPerDay": 5,
  "dmsDeclineCooldownDays": 30
}'::jsonb)
on conflict (id) do update
  set settings = excluded.settings || public.messaging_settings.settings;

-- messaging/001's, with the DM keys. messaging_client_settings (messaging/003)
-- returns the whole row, so it carries them already.
create or replace function public.messaging_set_settings(p_settings jsonb)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  k text;
  v jsonb;
  v_int numeric;
  v_str text;
  v_ok boolean;
begin
  if not public.messaging_is_dashboard_admin() then
    raise exception 'forbidden';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'invalid_settings';
  end if;
  for k, v in select * from jsonb_each(p_settings) loop
    -- Nested cases: SQL doesn't promise to short-circuit AND before a cast.
    v_int := case when jsonb_typeof(v) = 'number' then
               case when v::numeric = trunc(v::numeric) and v::numeric between 1 and 2147483647
                 then v::numeric end end;
    v_str := case when jsonb_typeof(v) = 'string' then v #>> '{}' end;
    v_ok := case
      when k = 'maxLength' then v_int <= 4000
      when k in ('ratePerMinute', 'maxCreatedPerMember', 'maxJoinedPerMember') then v_int is not null
      when k = 'nameMaxLength' then v_int <= 120
      when k = 'descriptionMaxLength' then v_int <= 1000
      when k = 'maxMembers' then jsonb_typeof(v) = 'null' or v_int is not null
      when k = 'moderation' then v_str in ('pre', 'post', 'reportOnly')
      when k = 'translation' then v_str in ('off', 'onDemand')
      when k = 'pushPreview' then v_str in ('full', 'sender', 'none')
      when k = 'onAccountDelete' then v_str in ('keep', 'eraseDms', 'eraseAll')
      when k = 'groupsPreview' then v_str in ('readOnly', 'none')
      when k in ('groupsRequireAccount', 'groupsCreateRequiresAccount') then jsonb_typeof(v) = 'boolean'
      when k = 'dmsFirstMessage' then v_str in ('direct', 'requests')
      when k in ('dmsReadReceipts', 'dmsRequireAccount') then jsonb_typeof(v) = 'boolean'
      when k = 'dmsRequestsPerDay' then v_int is not null
      when k = 'dmsDeclineCooldownDays' then v = '0'::jsonb or v_int <= 3650
      else false
    end;
    if not coalesce(v_ok, false) then
      raise exception 'invalid_setting:%', k;
    end if;
  end loop;
  update messaging_settings set settings = settings || p_settings where id = 1;
end;
$$;

-- ============ HELPERS ============
-- Every RPC that reads then changes a pair's DM state takes this lock first, so
-- two members starting, accepting, declining or writing at once run one at a time.
create or replace function public.dm_lock_pair(p_a uuid, p_b uuid)
returns void
language sql volatile
as $$
  select pg_advisory_xact_lock(hashtextextended('dm:' || least(p_a, p_b) || ':' || greatest(p_a, p_b), 0));
$$;

-- The recipient accepts: both active. The sender gets a center item when the inbox
-- module is in (conversation_id: see groups/001's remove_member).
create or replace function public.dm_accept(p_conversation uuid, p_uid uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_peer uuid;
begin
  update conversation_members set state = 'active'
  where conversation_id = p_conversation and user_id = p_uid and state = 'request';
  if not found then
    raise exception 'not_found';
  end if;
  select user_id into v_peer from conversation_members
  where conversation_id = p_conversation and user_id <> p_uid;
  if exists (select 1 from pg_attribute
             where attrelid = to_regclass('public.notifications') and attname = 'conversation_id'
               and not attisdropped) then
    insert into notifications (user_id, kind, actor_id, conversation_id)
    values (v_peer, 'dm_request_accepted', p_uid, p_conversation);
  elsif to_regclass('public.notifications') is not null then
    insert into notifications (user_id, kind, actor_id) values (v_peer, 'dm_request_accepted', p_uid);
  end if;
end;
$$;

-- The recipient declines, silently: the sender's side doesn't change. Everything
-- written before the cooldown ends stays out of the recipient's sight.
create or replace function public.dm_decline(p_conversation uuid, p_uid uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_until timestamptz := now()
    + make_interval(days => coalesce((public.messaging_setting('dmsDeclineCooldownDays'))::int, 30));
  v_peer uuid;
begin
  update conversation_members set state = 'declined', visible_from = v_until
  where conversation_id = p_conversation and user_id = p_uid and state = 'request';
  if not found then
    raise exception 'not_found';
  end if;
  select user_id into v_peer from conversation_members
  where conversation_id = p_conversation and user_id <> p_uid;
  insert into dm_declines (sender_id, recipient_id, until) values (v_peer, p_uid, v_until)
  on conflict (sender_id, recipient_id) do update set until = excluded.until;
end;
$$;

-- Why p_sender may not start a request to p_recipient now (null: they may, and in
-- requests mode the request is logged). Shared by start_dm (which raises it) and the
-- after-cooldown request in send_message (which then keeps the message silent).
-- Blocks are checked by both callers before.
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
  if coalesce(public.messaging_setting('dmsFirstMessage') #>> '{}', 'direct') = 'requests' then
    -- One count at a time per sender, so parallel requests can't all pass it.
    perform pg_advisory_xact_lock(hashtextextended('dm_requests:' || p_sender, 0));
    delete from dm_request_log where sender_id = p_sender and at <= now() - interval '1 day';
    if (select count(*) from dm_request_log where sender_id = p_sender)
       >= coalesce((public.messaging_setting('dmsRequestsPerDay'))::int, 5) then
      return 'too_many_requests';
    end if;
    insert into dm_request_log (sender_id, recipient_id) values (p_sender, p_recipient);
  end if;
  return null;
end;
$$;

-- The caller's DM peer in a conversation, null when it isn't the caller's DM.
create or replace function public.dm_peer_of(p_conversation uuid, p_uid uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select case when user_a = p_uid then user_b else user_a end
  from dm_pairs where conversation_id = p_conversation and p_uid in (user_a, user_b);
$$;

-- Groups both members are active in (visible ones), with up to 3 live names, most
-- active first. None without the groups module.
create or replace function public.dm_common_groups(p_a uuid, p_b uuid)
returns table (n int, names text[])
language plpgsql stable security definer set search_path = public
as $$
begin
  if to_regclass('public.groups') is null then
    return query select 0, '{}'::text[];
    return;
  end if;
  return query execute
    'select count(*)::int, coalesce((array_agg(g.name order by g.last_activity_at desc nulls last))[1:3], ''{}'')
     from public.groups g
     join public.conversation_members x
       on x.conversation_id = g.conversation_id and x.user_id = $1 and x.state = ''active''
     join public.conversation_members y
       on y.conversation_id = g.conversation_id and y.user_id = $2 and y.state = ''active''
     where g.status = ''visible'''
    using p_a, p_b;
end;
$$;

-- ============ READ RULES ============
-- messaging/001's, plus DMs: readable by their two members only (the recipient of a
-- pending request included, not after a decline) and never across a block. Groups
-- unchanged: an active member, or a signed-in previewer (not removed) of a visible
-- group while groups are previewable.
create or replace function public.can_read_conversation(p_conversation uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_visible boolean;
  v_kind text;
  v_state text;
begin
  if auth.uid() is null then
    return false;
  end if;
  select c.kind, m.state into v_kind, v_state
  from conversations c
  left join conversation_members m on m.conversation_id = c.id and m.user_id = auth.uid()
  where c.id = p_conversation;
  if v_kind = 'dm' then
    return coalesce(v_state in ('active', 'request'), false)
      and not exists (
        select 1 from conversation_members o
        where o.conversation_id = p_conversation and o.user_id <> auth.uid()
          and o.user_id = any (public.blocked_member_ids()));
  end if;
  if v_state = 'active' then
    return true;
  end if;
  -- A removed member doesn't keep reading as a previewer.
  if v_state = 'removed' then
    return false;
  end if;
  if to_regclass('public.groups') is null
     or coalesce(public.messaging_setting('groupsPreview') #>> '{}', 'readOnly') <> 'readOnly'
     or v_kind is distinct from 'group' then
    return false;
  end if;
  execute 'select exists (select 1 from public.groups where conversation_id = $1 and status = ''visible'')'
    into v_visible using p_conversation;
  return coalesce(v_visible, false);
end;
$$;

-- messaging/001's, plus the reader's visible_from (null everywhere but a DM recipient's
-- row). Likes, translations, image reads and Realtime go through this policy.
drop policy if exists "read messages of readable conversations" on public.messages;
create policy "read messages of readable conversations" on public.messages
  for select to authenticated
  using (
    public.can_read_conversation(conversation_id)
    and (status in ('visible', 'deleted') or author_id = auth.uid())
    and not (author_id = any ((select public.blocked_member_ids())::uuid[]))
    and created_at >= coalesce((select cm.visible_from from public.conversation_members cm
                                where cm.conversation_id = messages.conversation_id
                                  and cm.user_id = auth.uid()), '-infinity')
  );

-- The caller's conversation list (groups/003's when groups is installed, else
-- messaging/001's), with visible_from applied to the last message, its time and the
-- unread count: the security definer body doesn't go through the policy above.
do $do$
declare
  v_groups boolean := to_regclass('public.groups') is not null;
begin
  execute format($f$
    create or replace function public.list_conversations()
    returns table (
      conversation_id uuid,
      kind text,
      last_message_at timestamptz,
      last_message_id uuid,
      last_body text,
      last_author_id uuid,
      unread int,
      notify boolean,
      role text%s
    )
    language sql stable security definer set search_path = public
    as $fn$
      with b as (select public.blocked_member_ids() as ids)
      select c.id, c.kind,
        case when cm.visible_from is null then c.last_message_at else lm.created_at end,
        lm.id, lm.body, lm.author_id,
        (select count(*)::int from (
           select 1 from messages m
           where m.conversation_id = c.id and m.status = 'visible' and m.author_id <> auth.uid()
             and m.created_at > coalesce(cm.last_read_at, cm.joined_at)
             and m.created_at >= coalesce(cm.visible_from, '-infinity')
             and not (m.author_id = any (b.ids))
           limit 99
         ) u),
        cm.notify, cm.role%s
      from conversation_members cm
      join conversations c on c.id = cm.conversation_id%s
      cross join b
      left join lateral (
        select m.id, m.body, m.author_id, m.created_at from messages m
        where m.conversation_id = c.id
          and (m.status in ('visible', 'deleted') or m.author_id = auth.uid())
          and not (m.author_id = any (b.ids))
          and m.created_at >= coalesce(cm.visible_from, '-infinity')
        order by m.created_at desc, m.id desc
        limit 1
      ) lm on true
      where cm.user_id = auth.uid() and cm.state = 'active'
      order by coalesce(case when cm.visible_from is null then c.last_message_at else lm.created_at end,
                        c.created_at) desc;
    $fn$;
  $f$,
    case when v_groups then ',
      title text,
      image_path text,
      group_status text' else '' end,
    case when v_groups then ',
        case when gv.ok then g.name end,
        case when gv.ok then g.image_path end,
        case when gv.ok then g.status end' else '' end,
    case when v_groups then '
      left join groups g on g.conversation_id = c.id
      cross join lateral (
        select g.status = ''visible'' or g.created_by = auth.uid() as ok
      ) gv' else '' end);
end;
$do$;

-- ============ RPCS ============
-- The caller's own switch (no text to moderate, so not through update-profile).
create or replace function public.set_accepts_dms(p_on boolean)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  update profiles set accepts_dms = coalesce(p_on, true) where id = auth.uid();
end;
$$;

-- What the "Message" button needs for up to 200 members: whether they take DMs and
-- have an account (true without the accounts module). Never an account id; blocked
-- members (either way) get no row.
-- Dropped first: dms/003 adds a column, which create or replace can't take back.
drop function if exists public.profile_dm_flags(uuid[]);
create function public.profile_dm_flags(p_ids uuid[])
returns table (user_id uuid, accepts_dms boolean, has_account boolean)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids)
  select p.id, p.accepts_dms, public.has_account_link(p.id)
  from profiles p
  cross join b
  where auth.uid() is not null
    and p.id = any ((p_ids)[1:200])
    and not (p.id = any (b.ids));
$$;

-- Gets or creates the caller's DM with p_recipient. An existing DM opens whatever
-- its state: the sender of a declined request is never told. The caller's own
-- pending request from p_recipient is accepted; a DM the caller declined reopens
-- from now on, what they declined staying out of sight. A new DM checks the
-- recipient's switch, the account rule (both sides), a recent decline and the
-- per-day request budget.
create or replace function public.start_dm(p_recipient uuid)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := coalesce(public.messaging_setting('dmsFirstMessage') #>> '{}', 'direct');
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
    if v_state = 'request' then
      perform public.dm_accept(v_conv, v_uid);
    elsif v_state = 'declined' then
      update conversation_members set state = 'active', visible_from = now()
      where conversation_id = v_conv and user_id = v_uid;
      delete from dm_declines where sender_id = p_recipient and recipient_id = v_uid;
    end if;
    return v_conv;
  end if;

  v_refusal := public.dm_request_refusal(v_uid, p_recipient);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  insert into conversations (kind) values ('dm') returning id into v_conv;
  insert into dm_pairs (conversation_id, user_a, user_b)
  values (v_conv, least(v_uid, p_recipient), greatest(v_uid, p_recipient));
  insert into conversation_members (conversation_id, user_id, state, last_read_at) values
    (v_conv, v_uid, 'active', now()),
    (v_conv, p_recipient, case when v_mode = 'requests' then 'request' else 'active' end, null);
  return v_conv;
end;
$$;

create or replace function public.accept_request(p_conversation uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_peer uuid := public.dm_peer_of(p_conversation, auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_peer is null then
    raise exception 'not_found';
  end if;
  perform public.dm_lock_pair(v_uid, v_peer);
  if v_peer = any (public.blocked_member_ids()) then
    raise exception 'blocked';
  end if;
  perform public.dm_accept(p_conversation, v_uid);
end;
$$;

create or replace function public.decline_request(p_conversation uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_peer uuid := public.dm_peer_of(p_conversation, auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_peer is null then
    raise exception 'not_found';
  end if;
  perform public.dm_lock_pair(v_uid, v_peer);
  perform public.dm_decline(p_conversation, v_uid);
end;
$$;

-- Blocks the sender, reports the request's latest visible message (the dashboard can
-- then read it through admin_message_context), and declines.
create or replace function public.block_and_report_request(p_conversation uuid, p_reason text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_peer uuid := public.dm_peer_of(p_conversation, auth.uid());
  v_message uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_reason is null or p_reason not in ('spam', 'harassment', 'hate', 'inappropriate', 'other') then
    raise exception 'invalid_reason';
  end if;
  if v_peer is null then
    raise exception 'not_found';
  end if;
  perform public.dm_lock_pair(v_uid, v_peer);
  select m.id into v_message
  from conversation_members cm
  join messages m on m.conversation_id = cm.conversation_id and m.author_id = v_peer
    and m.status = 'visible' and m.created_at >= coalesce(cm.visible_from, '-infinity')
  where cm.conversation_id = p_conversation and cm.user_id = v_uid and cm.state = 'request'
  order by m.created_at desc, m.id desc
  limit 1;
  perform public.dm_decline(p_conversation, v_uid);
  -- An in-app admin can't be blocked (blocked_member_ids() ignores it): report only.
  if not coalesce((select is_admin from profiles where id = v_peer), false) then
    insert into blocks (blocker_id, blocked_id) values (v_uid, v_peer) on conflict do nothing;
  end if;
  if v_message is not null then
    insert into reports (reporter_id, reported_user_id, message_id, reason)
    values (v_uid, v_peer, v_message, p_reason);
  end if;
end;
$$;

-- The caller's DMs (active or pending request) with their peer, blocked pairs left out.
create or replace function public.dm_peers()
returns table (conversation_id uuid, peer_id uuid, my_state text)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids)
  select cm.conversation_id, o.user_id, cm.state
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id and c.kind = 'dm'
  join conversation_members o on o.conversation_id = cm.conversation_id and o.user_id <> cm.user_id
  cross join b
  where cm.user_id = auth.uid() and cm.state in ('active', 'request')
    and not (o.user_id = any (b.ids));
$$;

-- The caller's pending requests, newest first: those with a visible message from the
-- sender they may read, with the sender's context (groups in common, member since).
create or replace function public.list_dm_requests()
returns table (
  conversation_id uuid,
  sender_id uuid,
  last_body text,
  last_has_image boolean,
  last_at timestamptz,
  groups_in_common int,
  common_group_names text[],
  member_since timestamptz
)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids)
  select cm.conversation_id, o.user_id, lm.body, lm.image_path is not null, lm.created_at,
    cg.n, cg.names, p.created_at
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id and c.kind = 'dm'
  join conversation_members o on o.conversation_id = cm.conversation_id and o.user_id <> cm.user_id
  join profiles p on p.id = o.user_id
  cross join b
  cross join lateral (
    select m.body, m.image_path, m.created_at from messages m
    where m.conversation_id = cm.conversation_id and m.author_id = o.user_id and m.status = 'visible'
      and m.created_at >= coalesce(cm.visible_from, '-infinity')
    order by m.created_at desc, m.id desc
    limit 1
  ) lm
  cross join lateral public.dm_common_groups(cm.user_id, o.user_id) cg
  where cm.user_id = auth.uid() and cm.state = 'request'
    and not (o.user_id = any (b.ids))
  order by lm.created_at desc, cm.conversation_id;
$$;

-- When the peer last read the DM ("Seen"): only with dmsReadReceipts, both active,
-- not blocked, and, after the peer reopened a DM they had declined, once the caller
-- wrote since (no "Seen" on messages the peer never saw). Null otherwise, so a
-- request never tells its sender it was read.
create or replace function public.dm_peer_read(p_conversation uuid)
returns timestamptz
language sql stable security definer set search_path = public
as $$
  select o.last_read_at
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id and c.kind = 'dm'
  join conversation_members o on o.conversation_id = cm.conversation_id and o.user_id <> cm.user_id
  where cm.conversation_id = p_conversation and cm.user_id = auth.uid()
    and cm.state = 'active' and o.state = 'active'
    and coalesce((public.messaging_setting('dmsReadReceipts'))::boolean, false)
    and not (o.user_id = any (public.blocked_member_ids()))
    and (o.visible_from is null
         or o.visible_from <= (select max(m.created_at) from messages m
                               where m.conversation_id = cm.conversation_id and m.author_id = cm.user_id));
$$;

-- messaging/006's, plus, in a DM whose recipient declined: once the cooldown is over,
-- the message starts a new request that shows from it on, if a new DM's checks pass;
-- otherwise (and within the cooldown) it is stored, readable by its author only. A
-- reply can't quote a message the caller may not see.
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

  -- The new request runs a new DM's checks (dm_request_refusal); one that fails
  -- leaves the recipient declined and the message silent, as during the cooldown.
  if v_kind = 'dm' then
    v_peer := public.dm_peer_of(p_conversation, v_uid);
    perform public.dm_lock_pair(v_uid, v_peer);
    if exists (select 1 from conversation_members
               where conversation_id = p_conversation and user_id = v_peer and state = 'declined') then
      -- Only for a declined row: the refusal check logs a request when it passes.
      if public.dm_request_refusal(v_uid, v_peer) is null then
        update conversation_members set state = 'request', visible_from = now()
        where conversation_id = p_conversation and user_id = v_peer;
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

-- messaging/001's, plus the caller's visible_from: a message they may not see can't be liked.
create or replace function public.set_message_like(p_message uuid, p_liked boolean)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not p_liked then
    delete from message_likes where message_id = p_message and user_id = v_uid;
    if found then
      update messages set like_count = greatest(like_count - 1, 0) where id = p_message;
    end if;
    return;
  end if;
  if public.current_user_banned() then
    raise exception 'banned';
  end if;
  if not exists (
    select 1 from messages m
    join conversation_members cm
      on cm.conversation_id = m.conversation_id and cm.user_id = v_uid and cm.state = 'active'
    where m.id = p_message and m.status = 'visible'
      and m.created_at >= coalesce(cm.visible_from, '-infinity')
      and not (m.author_id = any (public.blocked_member_ids()))
  ) then
    raise exception 'not_found';
  end if;
  insert into message_likes (message_id, user_id) values (p_message, v_uid)
  on conflict do nothing;
  if found then
    update messages set like_count = like_count + 1 where id = p_message;
  end if;
end;
$$;

-- Unread messages of followed conversations (DMs always, groups when notify is on),
-- plus one per pending request (those list_dm_requests shows). The badge and
-- unread_followed_messages_for (messaging/002) read it.
create or replace function public.unread_followed_messages()
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce((select sum(unread) from public.list_conversations() where notify or kind = 'dm'), 0)::int
    + (select count(*)::int
       from conversation_members cm
       join conversations c on c.id = cm.conversation_id and c.kind = 'dm'
       join conversation_members o on o.conversation_id = cm.conversation_id and o.user_id <> cm.user_id
       where cm.user_id = auth.uid() and cm.state = 'request'
         and not (o.user_id = any (public.blocked_member_ids()))
         and exists (select 1 from messages m
                     where m.conversation_id = cm.conversation_id and m.author_id = o.user_id
                       and m.status = 'visible'
                       and m.created_at >= coalesce(cm.visible_from, '-infinity')));
$$;

-- ============ ACCOUNT DELETION ============
-- messaging/001's, with eraseDms: the member's DM messages are deleted, group
-- messages kept. Their image files stay in message-images: groups/005's sweep lists
-- them when groups is installed; without groups nothing sweeps them yet.
create or replace function public.messaging_on_account_delete(p_uid uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_mode text := coalesce(public.messaging_setting('onAccountDelete') #>> '{}', 'keep');
begin
  if v_mode = 'eraseAll' then
    delete from messages where author_id = p_uid;
  elsif v_mode = 'eraseDms' then
    delete from messages m using conversations c
    where c.id = m.conversation_id and c.kind = 'dm' and m.author_id = p_uid;
  end if;
end;
$$;

-- ============ PROFILE MERGE ============
-- The more open state first (merge_messaging).
create or replace function public.dm_state_rank(p_state text)
returns int
language sql immutable
as $$
  select case p_state when 'active' then 0 when 'request' then 1 else 2 end;
$$;

-- messaging/001's, plus DMs, first: a DM between the two is dropped (it would be with
-- oneself); two DMs with one member become one, the older, which takes the other's
-- messages. Messages a member never saw (before their row's visible_from, or any
-- while their row is declined) are deleted first, so no merged row can reveal them (a
-- report on one keeps its body in details); each person's kept row then takes the
-- state and visible_from of the more open of their two rows (active, request,
-- declined), an active row never keeping a future visible_from. Pairs, declines and
-- the request log move to main.
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

-- ============ GRANTS ============
revoke execute on function public.dm_lock_pair(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.dm_accept(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.dm_decline(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.dm_peer_of(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.dm_request_refusal(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.dm_state_rank(text) from public, anon, authenticated;
revoke execute on function public.dm_common_groups(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.set_accepts_dms(boolean) from public, anon;
revoke execute on function public.profile_dm_flags(uuid[]) from public, anon;
revoke execute on function public.start_dm(uuid) from public, anon;
revoke execute on function public.accept_request(uuid) from public, anon;
revoke execute on function public.decline_request(uuid) from public, anon;
revoke execute on function public.block_and_report_request(uuid, text) from public, anon;
revoke execute on function public.dm_peers() from public, anon;
revoke execute on function public.list_dm_requests() from public, anon;
revoke execute on function public.dm_peer_read(uuid) from public, anon;
revoke execute on function public.list_conversations() from public, anon;

grant execute on function public.set_accepts_dms(boolean) to authenticated;
grant execute on function public.profile_dm_flags(uuid[]) to authenticated;
grant execute on function public.start_dm(uuid) to authenticated;
grant execute on function public.accept_request(uuid) to authenticated;
grant execute on function public.decline_request(uuid) to authenticated;
grant execute on function public.block_and_report_request(uuid, text) to authenticated;
grant execute on function public.dm_peers() to authenticated;
grant execute on function public.list_dm_requests() to authenticated;
grant execute on function public.dm_peer_read(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;
