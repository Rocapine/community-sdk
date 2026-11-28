-- community-sdk messaging/001_messaging.sql (schema v1)
-- Messaging module: the chat core shared by group chats (groups module) and, later,
-- direct messages. Conversations, their members, messages, likes, the edit history
-- the dashboard reads, the on-demand translation cache, and the backend settings.
--
-- Clients read through RLS and write only through the security definer RPCs below,
-- which check membership, bans, blocks, the length cap, the rate limit and the
-- moderation mode. The limits live in `messaging_settings` (one row), set with
-- messaging_set_settings(jsonb) from the service role or the SQL editor; the app's
-- config must carry the same values.
--
-- Group preview (`groupsPreview = 'readOnly'`) reads `public.groups`, which the
-- groups module creates: until then can_read_conversation() only lets members in.
-- Account rules read `public.account_links` only when the accounts module is in.
-- merge_messaging (called by accounts/004's merge_profiles) and messaging_on_account_delete
-- (called by account-delete) live here: they serve groups and, later, DMs.
-- Requires core. Idempotent on its own; re-running it after groups/003 (which changes
-- list_conversations()' return type) is not supported: the CLI applies each template once.

-- ============ TABLES ============
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

-- removed_by is a plain uuid (a member or an admin), not a profile reference.
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'creator')),
  state text not null default 'active' check (state in ('active', 'request', 'removed')),
  notify boolean not null default false,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  removed_by uuid,
  removed_at timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id, state);

-- status uses the feed's vocabulary (pending | visible | hidden | deleted), so the
-- moderation pipeline treats messages like comments. A deleted message keeps its
-- row as a placeholder with body and media cleared (the original is in
-- message_versions); an admin removal hides it instead.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text check (char_length(body) <= 4000),
  image_path text,
  attachment_type text check (char_length(attachment_type) <= 40),
  attachment_id text check (char_length(attachment_id) <= 200),
  reply_to_id uuid references public.messages(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'visible', 'hidden', 'deleted')),
  deleted_by text check (deleted_by in ('author', 'creator', 'admin')),
  moderation_reason text,
  moderated_at timestamptz,              -- null = not yet seen by the AI
  edited_at timestamptz,
  lang text,
  like_count int not null default 0,     -- kept by set_message_like
  created_at timestamptz not null default now()
);
-- Databases that ran an earlier draft of this file.
alter table public.messages add column if not exists like_count int not null default 0;
create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists messages_author_idx on public.messages (author_id, created_at desc);
create index if not exists messages_moderation_idx
  on public.messages (created_at) where moderated_at is null;
create index if not exists messages_image_path_idx
  on public.messages (image_path) where image_path is not null;

create table if not exists public.message_likes (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Every previous version of an edited or deleted message. Dashboard only.
create table if not exists public.message_versions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  body text,
  image_path text,
  replaced_at timestamptz not null default now()
);
create index if not exists message_versions_message_idx
  on public.message_versions (message_id, replaced_at);

-- On-demand translation cache, dropped when the message is edited or deleted.
create table if not exists public.message_translations (
  message_id uuid not null references public.messages(id) on delete cascade,
  locale text not null,
  body text not null,
  engine text,
  created_at timestamptz not null default now(),
  primary key (message_id, locale)
);

-- ============ SETTINGS ============
-- One row. Re-running adds the keys a newer migration introduces and keeps the
-- values already set.
create table if not exists public.messaging_settings (
  id int primary key default 1 check (id = 1),
  settings jsonb not null
);
insert into public.messaging_settings (id, settings) values (1, '{
  "moderation": "post",
  "translation": "onDemand",
  "pushPreview": "full",
  "onAccountDelete": "keep",
  "maxLength": 2000,
  "ratePerMinute": 20,
  "groupsPreview": "readOnly",
  "groupsRequireAccount": false,
  "groupsCreateRequiresAccount": true,
  "maxCreatedPerMember": 3,
  "maxJoinedPerMember": 50,
  "maxMembers": null,
  "nameMaxLength": 60,
  "descriptionMaxLength": 500
}'::jsonb)
on conflict (id) do update
  set settings = excluded.settings || public.messaging_settings.settings;

-- ============ CLIENT ACCESS ============
-- Reads through RLS only; every write goes through an RPC.
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_likes enable row level security;
alter table public.message_versions enable row level security;
alter table public.message_translations enable row level security;
alter table public.messaging_settings enable row level security;

revoke all on public.conversations, public.conversation_members, public.messages,
  public.message_likes, public.message_versions, public.message_translations,
  public.messaging_settings
  from public, anon, authenticated;
grant select on public.conversations, public.conversation_members, public.messages,
  public.message_likes, public.message_translations
  to authenticated;

-- ============ HELPERS ============
-- A setting's value (jsonb; null when unset). The settings are not secret.
create or replace function public.messaging_setting(p_key text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select settings -> p_key from messaging_settings where id = 1;
$$;

-- True when the accounts module is not installed (no account rule can apply).
create or replace function public.has_account_link(p_uid uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if to_regclass('public.account_links') is null then
    return true;
  end if;
  return exists (select 1 from account_links where profile_id = p_uid);
end;
$$;

create or replace function public.my_account_linked()
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and public.has_account_link(auth.uid());
$$;

-- The dashboard: the service role, or a direct database session that carries no
-- JWT (the SQL editor). API requests always connect as `authenticator` with a JWT,
-- so neither branch opens to a signed-in member. In-app admin powers use
-- profiles.is_admin (current_user_admin()) instead.
create or replace function public.messaging_is_dashboard_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role'
    or (auth.jwt() is null and session_user <> 'authenticator');
$$;

-- An earlier draft of this file had a second admin helper.
drop function if exists public.messaging_is_admin();

create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from conversation_members
    where conversation_id = p_conversation and user_id = auth.uid() and state = 'active'
  );
$$;

-- An active member, or anyone signed in (and not removed from it) on a visible
-- group while groups are previewable. `groups` is the groups module's table: absent, only members read.
create or replace function public.can_read_conversation(p_conversation uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_visible boolean;
begin
  if auth.uid() is null then
    return false;
  end if;
  if public.is_conversation_member(p_conversation) then
    return true;
  end if;
  -- A removed member doesn't keep reading as a previewer.
  if exists (select 1 from conversation_members
             where conversation_id = p_conversation and user_id = auth.uid() and state = 'removed') then
    return false;
  end if;
  if to_regclass('public.groups') is null
     or coalesce(public.messaging_setting('groupsPreview') #>> '{}', 'readOnly') <> 'readOnly'
     or not exists (select 1 from conversations where id = p_conversation and kind = 'group') then
    return false;
  end if;
  execute 'select exists (select 1 from public.groups where conversation_id = $1 and status = ''visible'')'
    into v_visible using p_conversation;
  return coalesce(v_visible, false);
end;
$$;

-- ============ READ POLICIES ============
drop policy if exists "read readable conversations" on public.conversations;
create policy "read readable conversations" on public.conversations
  for select to authenticated using (public.can_read_conversation(id));

-- Other members' rows come through list_conversation_members (groups module).
drop policy if exists "read own memberships" on public.conversation_members;
create policy "read own memberships" on public.conversation_members
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "read messages of readable conversations" on public.messages;
create policy "read messages of readable conversations" on public.messages
  for select to authenticated
  using (
    public.can_read_conversation(conversation_id)
    and (status in ('visible', 'deleted') or author_id = auth.uid())
    and not (author_id = any ((select public.blocked_member_ids())::uuid[]))
  );

drop policy if exists "read likes of readable messages" on public.message_likes;
create policy "read likes of readable messages" on public.message_likes
  for select to authenticated
  using (
    exists (select 1 from public.messages m where m.id = message_likes.message_id)
    and not (user_id = any ((select public.blocked_member_ids())::uuid[]))
  );

drop policy if exists "read translations of readable messages" on public.message_translations;
create policy "read translations of readable messages" on public.message_translations
  for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_translations.message_id));

-- ============ RPCS ============
-- Status of a new or edited message: an image waits for moderation whatever the
-- mode; 'pre' waits; 'post' shows and queues for the AI; 'reportOnly' shows and
-- never reaches the AI (moderated_at set).
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
-- (profiles.is_admin) hides (status hidden, the row kept for the dashboard); a group's creator deletes others'
-- messages, never an admin account's ("Deleted by the group's creator").
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

-- Liking needs a visible message the caller reads, as an active member; unliking
-- always works. like_count moves only when a like row is really added or removed,
-- so a like reaches Realtime subscribers as an UPDATE of the message.
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

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language sql volatile security definer set search_path = public
as $$
  update conversation_members set last_read_at = now()
  where conversation_id = p_conversation and user_id = auth.uid() and state = 'active';
$$;

-- The caller's active conversations, latest activity first. unread: visible
-- messages since last read (or since joining), not the caller's, not by a blocked
-- member, capped at 99.
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
  role text
)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids)
  select c.id, c.kind, c.last_message_at, lm.id, lm.body, lm.author_id,
    (select count(*)::int from (
       select 1 from messages m
       where m.conversation_id = c.id and m.status = 'visible' and m.author_id <> auth.uid()
         and m.created_at > coalesce(cm.last_read_at, cm.joined_at)
         and not (m.author_id = any (b.ids))
       limit 99
     ) u),
    cm.notify, cm.role
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id
  cross join b
  left join lateral (
    select m.id, m.body, m.author_id from messages m
    where m.conversation_id = c.id
      and (m.status in ('visible', 'deleted') or m.author_id = auth.uid())
      and not (m.author_id = any (b.ids))
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where cm.user_id = auth.uid() and cm.state = 'active'
  order by coalesce(c.last_message_at, c.created_at) desc;
$$;

create or replace function public.unread_followed_messages()
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(unread), 0)::int from public.list_conversations() where notify;
$$;

-- The dashboard's view of a flagged message and its neighbours. A DM answers only
-- for a reported message or one moderation hid, within at most 50 messages each way.
create or replace function public.admin_message_context(
  p_message uuid,
  p_before int default 20,
  p_after int default 20
)
returns setof public.messages
language plpgsql stable security definer set search_path = public
as $$
declare
  v_msg public.messages;
  v_kind text;
begin
  if not public.messaging_is_dashboard_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_msg from messages where id = p_message;
  if not found then
    raise exception 'not_found';
  end if;
  select kind into v_kind from conversations where id = v_msg.conversation_id;
  if v_kind = 'dm' and not (
    exists (select 1 from reports where message_id = p_message)
    or (v_msg.status = 'hidden' and v_msg.moderation_reason is not null)
  ) then
    raise exception 'forbidden';
  end if;
  return query
  select * from (
    (select * from messages m
     where m.conversation_id = v_msg.conversation_id
       and (m.created_at, m.id) < (v_msg.created_at, v_msg.id)
     order by m.created_at desc, m.id desc
     limit least(greatest(coalesce(p_before, 20), 0), 50))
    union all
    select v_msg.*
    union all
    (select * from messages m
     where m.conversation_id = v_msg.conversation_id
       and (m.created_at, m.id) > (v_msg.created_at, v_msg.id)
     order by m.created_at, m.id
     limit least(greatest(coalesce(p_after, 20), 0), 50))
  ) w
  order by w.created_at, w.id;
end;
$$;

-- Merges the given keys into the settings, e.g.
-- select public.messaging_set_settings('{"moderation": "pre"}');
-- Every key is checked; an unknown key or a bad value raises invalid_setting:<key>
-- (a module adding a key extends this list).
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
      else false
    end;
    if not coalesce(v_ok, false) then
      raise exception 'invalid_setting:%', k;
    end if;
  end loop;
  update messaging_settings set settings = settings || p_settings where id = 1;
end;
$$;

-- ============ REPORTS ============
-- A member reports a message they can read, naming its author.
alter table public.reports
  add column if not exists message_id uuid references public.messages(id) on delete set null;
create index if not exists reports_message_idx on public.reports (message_id)
  where message_id is not null;
-- A report needs a target when it is made, not forever: a target deleted later
-- (`on delete set null`, e.g. a deleted conversation) leaves the report for the
-- record. So the old CHECK becomes an insert trigger. group_id is read through
-- to_jsonb so this works before the groups module adds the column.
alter table public.reports drop constraint if exists reports_check;
alter table public.reports drop constraint if exists reports_target_check;
create or replace function public.reports_require_target()
returns trigger
language plpgsql
as $$
declare
  r jsonb := to_jsonb(new);
begin
  if num_nonnulls(r ->> 'post_id', r ->> 'comment_id', r ->> 'message_id', r ->> 'group_id') = 0 then
    raise exception 'report_without_target' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists reports_require_target on public.reports;
create trigger reports_require_target
  before insert on public.reports
  for each row execute function public.reports_require_target();

drop policy if exists "report a readable message" on public.reports;
create policy "report a readable message" on public.reports
  as restrictive for insert to authenticated
  with check (
    message_id is null
    or exists (
      select 1 from public.messages m
      where m.id = reports.message_id and m.author_id = reports.reported_user_id
    )
  );

-- ============ REALTIME ============
-- New and changed messages reach subscribers through postgres_changes, filtered by
-- the read policies above; a like is an UPDATE of like_count. message_likes stays
-- out: Realtime can't filter DELETE events by RLS, so unlikes would reach anyone.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
    -- An earlier draft of this file published it.
    if exists (select 1 from pg_publication_tables
               where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_likes') then
      alter publication supabase_realtime drop table public.message_likes;
    end if;
  end if;
end $$;

-- Typing: a private broadcast channel per conversation, topic `conversation:<id>`.
-- Readers (group previewers included) listen; only active members send.
drop policy if exists "messaging: readers join conversation channels" on realtime.messages;
create policy "messaging: readers join conversation channels" on realtime.messages
  for select to authenticated
  using (
    case when realtime.topic() ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_read_conversation(split_part(realtime.topic(), ':', 2)::uuid)
      else false end
  );
drop policy if exists "messaging: members send on conversation channels" on realtime.messages;
create policy "messaging: members send on conversation channels" on realtime.messages
  for insert to authenticated
  with check (
    case when realtime.topic() ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_conversation_member(split_part(realtime.topic(), ':', 2)::uuid)
      else false end
  );

-- ============ STORAGE ============
-- Private bucket: `<conversation_id>/<uid>/<uuid>.<ext>`. The uploader reads their
-- own files; anyone else only the image of a visible message they can read (not a
-- pending, hidden or deleted one). No UPDATE/DELETE policies: removal is done by the
-- Edge Functions with the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('message-images', 'message-images', false, 2097152,
          array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

drop policy if exists "message image upload by member" on storage.objects;
create policy "message image upload by member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-images'
    and (storage.foldername(name))[2] = auth.uid()::text
    and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_conversation_member(((storage.foldername(name))[1])::uuid)
      else false end
  );
drop policy if exists "message image read by readers" on storage.objects;
create policy "message image read by readers" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-images'
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1 from public.messages m
        where m.image_path = storage.objects.name and m.status = 'visible'
          and public.can_read_conversation(m.conversation_id)
      )
    )
  );

-- ============ PROFILE MERGE ============
-- Called by merge_profiles (accounts/004). main keeps its row where both are members
-- (the earliest joined_at, notify OR-ed, creator if either was); likes deduplicated
-- with like_count kept in step. The groups module's tables are handled when installed
-- (created groups, removals, recounted member counts).
create or replace function public.merge_messaging(p_main uuid, p_other uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_convs uuid[];
begin
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

-- ============ ACCOUNT DELETION ============
-- Applied by account-delete before the profile is reset. keep: messages stay under the
-- placeholder name; eraseAll: every message of the member is deleted; eraseDms: DMs
-- arrive with the dms module (nothing yet).
create or replace function public.messaging_on_account_delete(p_uid uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if coalesce(public.messaging_setting('onAccountDelete') #>> '{}', 'keep') = 'eraseAll' then
    delete from messages where author_id = p_uid;
  end if;
end;
$$;

-- ============ GRANTS ============
revoke execute on function public.messaging_setting(text) from public, anon;
revoke execute on function public.has_account_link(uuid) from public, anon, authenticated;
revoke execute on function public.my_account_linked() from public, anon;
revoke execute on function public.messaging_is_dashboard_admin() from public, anon, authenticated;
revoke execute on function public.reports_require_target() from public, anon, authenticated;
revoke execute on function public.is_conversation_member(uuid) from public, anon;
revoke execute on function public.can_read_conversation(uuid) from public, anon;
revoke execute on function public.send_message(uuid, text, uuid, text, text, text) from public, anon;
revoke execute on function public.edit_message(uuid, text) from public, anon;
revoke execute on function public.delete_message(uuid) from public, anon;
revoke execute on function public.set_message_like(uuid, boolean) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
revoke execute on function public.list_conversations() from public, anon;
revoke execute on function public.unread_followed_messages() from public, anon;
revoke execute on function public.admin_message_context(uuid, int, int) from public, anon;
revoke execute on function public.messaging_set_settings(jsonb) from public, anon;
revoke execute on function public.merge_messaging(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.messaging_on_account_delete(uuid) from public, anon, authenticated;

grant execute on function public.messaging_setting(text) to authenticated;
grant execute on function public.my_account_linked() to authenticated;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.can_read_conversation(uuid) to authenticated;
grant execute on function public.send_message(uuid, text, uuid, text, text, text) to authenticated;
grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.set_message_like(uuid, boolean) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;
grant execute on function public.unread_followed_messages() to authenticated;
grant execute on function public.admin_message_context(uuid, int, int) to authenticated, service_role;
grant execute on function public.messaging_set_settings(jsonb) to authenticated, service_role;
grant execute on function public.messaging_is_dashboard_admin() to service_role;
grant execute on function public.merge_messaging(uuid, uuid) to service_role;
grant execute on function public.messaging_on_account_delete(uuid) to service_role;
