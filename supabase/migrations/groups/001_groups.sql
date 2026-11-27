-- community-sdk groups/001_groups.sql (schema v1)
-- Groups module: public group chats on the messaging core. Group metadata (live values,
-- and the pending values of a creation or an edit until moderation approves them), its
-- translations, removals, explore search, member lists, online counts, the dashboard's
-- transfer and live edit, the profile-merge and account-deletion hooks.
--
-- Clients read groups through RLS and write only through the security definer RPCs
-- below. Limits come from `messaging_settings` (messaging/001). "Admin" in the app is
-- profiles.is_admin (current_user_admin()); admin_transfer_group and admin_edit_group
-- are the dashboard's (messaging_is_dashboard_admin()). Account rules read
-- `account_links` only when the accounts module is installed (has_account_link()).
-- Requires core and messaging/001. Fully idempotent.

-- ============ TABLES ============
-- Moderation copies pending_* into the live columns: the live ones only ever hold
-- approved values, and search reads them only.
create table if not exists public.groups (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  name text check (char_length(name) <= 120),
  description text check (char_length(description) <= 1000),
  image_path text,
  pending_name text check (char_length(pending_name) <= 120),
  pending_description text check (char_length(pending_description) <= 1000),
  pending_image_path text,
  status text not null default 'pending' check (status in ('pending', 'visible', 'hidden', 'deleted')),
  rejected_fields text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  member_count int not null default 1,
  last_activity_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, ''))
  ) stored,
  created_at timestamptz not null default now()
);
create index if not exists groups_search_idx on public.groups using gin (search);
create index if not exists groups_activity_idx on public.groups (last_activity_at desc);
create index if not exists groups_created_by_idx on public.groups (created_by);

-- Written at approval by the translation pipeline, one row per configured locale.
create table if not exists public.group_translations (
  group_id uuid not null references public.groups(conversation_id) on delete cascade,
  locale text not null,
  name text,
  description text,
  primary key (group_id, locale)
);

-- A removed member can't rejoin until the creator or an admin readmits them.
-- removed_by is a plain uuid (the creator or an admin).
create table if not exists public.group_removals (
  group_id uuid not null references public.groups(conversation_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  removed_by uuid,
  removed_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ============ CLIENT ACCESS ============
alter table public.groups enable row level security;
alter table public.group_translations enable row level security;
alter table public.group_removals enable row level security;
revoke all on public.groups, public.group_translations, public.group_removals
  from public, anon, authenticated;
grant select on public.groups, public.group_translations, public.group_removals to authenticated;

drop policy if exists "read visible or own groups" on public.groups;
create policy "read visible or own groups" on public.groups
  for select to authenticated
  using (status = 'visible' or created_by = auth.uid());

drop policy if exists "read translations of readable groups" on public.group_translations;
create policy "read translations of readable groups" on public.group_translations
  for select to authenticated
  using (exists (select 1 from public.groups g where g.conversation_id = group_translations.group_id));

-- ============ HELPERS ============
-- The group's active creator (who hasn't left and isn't banned) or an in-app admin.
create or replace function public.can_manage_group(p_group uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_user_admin() or (not public.current_user_banned() and exists (
    select 1 from conversation_members
    where conversation_id = p_group and user_id = auth.uid() and role = 'creator' and state = 'active'
  ));
$$;

drop policy if exists "managers read removals" on public.group_removals;
create policy "managers read removals" on public.group_removals
  for select to authenticated
  using (user_id = auth.uid() or public.can_manage_group(group_id));

create or replace function public.group_recount_members(p_group uuid)
returns void
language sql volatile security definer set search_path = public
as $$
  update groups set member_count = (
    select count(*) from conversation_members where conversation_id = p_group and state = 'active'
  ) where conversation_id = p_group;
$$;

-- Active group memberships of a member, for maxJoinedPerMember.
create or replace function public.group_joined_count(p_uid uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int from conversation_members cm
  join conversations c on c.id = cm.conversation_id and c.kind = 'group'
  where cm.user_id = p_uid and cm.state = 'active';
$$;

-- Trims, checks the configured caps and the pending image folder. Returns the trimmed
-- name and description (null when empty).
create or replace function public.group_check_fields(
  p_name text, p_description text, p_image_path text,
  out o_name text, out o_description text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  o_name := nullif(btrim(coalesce(p_name, '')), '');
  o_description := nullif(btrim(coalesce(p_description, '')), '');
  if char_length(o_name) > coalesce((public.messaging_setting('nameMaxLength'))::int, 60) then
    raise exception 'name_too_long';
  end if;
  if char_length(o_description) > coalesce((public.messaging_setting('descriptionMaxLength'))::int, 500) then
    raise exception 'description_too_long';
  end if;
  if p_image_path is not null
     and p_image_path !~ ('^pending/' || auth.uid() || '/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$') then
    raise exception 'invalid_image_path';
  end if;
end;
$$;

-- ============ RPCS ============
-- The group exists for its creator only (status pending, values in pending_*) until
-- moderation approves it; the creator can already write in it.
create or replace function public.create_group(p_name text, p_description text, p_image_path text default null)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_description text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if public.current_user_banned() then
    raise exception 'banned';
  end if;
  if coalesce((public.messaging_setting('groupsCreateRequiresAccount'))::boolean, true)
     and not public.has_account_link(v_uid) then
    raise exception 'account_required';
  end if;
  select o_name, o_description into v_name, v_description
  from public.group_check_fields(p_name, p_description, p_image_path);
  if v_name is null then
    raise exception 'name_required';
  end if;
  -- One creation at a time per member, so parallel calls can't all pass the counts.
  perform pg_advisory_xact_lock(hashtextextended('create_group:' || v_uid, 0));
  if not public.current_user_admin()
     and (select count(*) from groups where created_by = v_uid and status <> 'deleted')
         >= coalesce((public.messaging_setting('maxCreatedPerMember'))::int, 3) then
    raise exception 'too_many_groups';
  end if;
  if public.group_joined_count(v_uid) >= coalesce((public.messaging_setting('maxJoinedPerMember'))::int, 50) then
    raise exception 'too_many_joined';
  end if;

  insert into conversations (kind) values ('group') returning id into v_id;
  insert into conversation_members (conversation_id, user_id, role, notify)
    values (v_id, v_uid, 'creator', false);
  insert into groups (conversation_id, pending_name, pending_description, pending_image_path, created_by)
    values (v_id, v_name, v_description, p_image_path, v_uid);
  return v_id;
end;
$$;

-- Writes the pending values (null keeps a field as it is); the live values stay shown
-- until moderation approves. Resubmitting clears the rejected fields.
create or replace function public.edit_group(p_group uuid, p_name text, p_description text, p_image_path text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_name text;
  v_description text;
begin
  if not public.can_manage_group(p_group) then
    raise exception 'forbidden';
  end if;
  if public.current_user_banned() then
    raise exception 'banned';
  end if;
  select o_name, o_description into v_name, v_description
  from public.group_check_fields(p_name, p_description, p_image_path);
  if p_name is not null and v_name is null then
    raise exception 'name_required';
  end if;
  update groups set
    pending_name = coalesce(v_name, pending_name),
    pending_description = case when p_description is null then pending_description else v_description end,
    pending_image_path = coalesce(p_image_path, pending_image_path),
    rejected_fields = '{}'
  where conversation_id = p_group and status <> 'deleted';
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

create or replace function public.delete_group(p_group uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if not public.can_manage_group(p_group) then
    raise exception 'forbidden';
  end if;
  update groups set status = 'deleted', member_count = 0 where conversation_id = p_group;
  update conversation_members set state = 'removed', removed_by = auth.uid(), removed_at = now()
  where conversation_id = p_group and state <> 'removed';
end;
$$;

-- Instant on a visible group. Idempotent for an active member.
create or replace function public.join_group(p_group uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_max jsonb := public.messaging_setting('maxMembers');
  v_count int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  -- The group row lock serialises joins, so maxMembers holds.
  select member_count into v_count from groups
  where conversation_id = p_group and status = 'visible' for update;
  if not found then
    raise exception 'not_found';
  end if;
  if public.is_conversation_member(p_group) then
    return;
  end if;
  if public.current_user_banned() then
    raise exception 'banned';
  end if;
  if exists (select 1 from group_removals where group_id = p_group and user_id = v_uid) then
    raise exception 'removed_from_group';
  end if;
  if coalesce((public.messaging_setting('groupsRequireAccount'))::boolean, false)
     and not public.has_account_link(v_uid) then
    raise exception 'account_required';
  end if;
  if jsonb_typeof(v_max) = 'number' and v_count >= v_max::int then
    raise exception 'group_full';
  end if;
  if public.group_joined_count(v_uid) >= coalesce((public.messaging_setting('maxJoinedPerMember'))::int, 50) then
    raise exception 'too_many_joined';
  end if;
  insert into conversation_members (conversation_id, user_id) values (p_group, v_uid)
  on conflict (conversation_id, user_id) do update set
    role = 'member', state = 'active', notify = false, joined_at = now(),
    last_read_at = null, removed_by = null, removed_at = null;
  perform public.group_recount_members(p_group);
end;
$$;

-- A creator leaving keeps the group: the admins manage it from then on. A removed
-- member's row stays, so they don't preview the group again.
create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  delete from conversation_members
  where conversation_id = p_group and user_id = auth.uid() and state = 'active';
  if found then
    perform public.group_recount_members(p_group);
  end if;
end;
$$;

-- The creator never removes an admin account; nobody removes themselves (leave_group).
create or replace function public.remove_member(p_group uuid, p_user uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_was_active boolean;
begin
  if not public.can_manage_group(p_group) or p_user = v_uid
     or (not public.current_user_admin()
         and coalesce((select is_admin from profiles where id = p_user), false)) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from groups where conversation_id = p_group and status <> 'deleted') then
    raise exception 'not_found';
  end if;
  insert into group_removals (group_id, user_id, removed_by) values (p_group, p_user, v_uid)
  on conflict (group_id, user_id) do nothing;
  v_was_active := exists (select 1 from conversation_members
                          where conversation_id = p_group and user_id = p_user and state = 'active');
  insert into conversation_members (conversation_id, user_id, state, removed_by, removed_at)
    values (p_group, p_user, 'removed', v_uid, now())
  on conflict (conversation_id, user_id) do update set
    state = 'removed', removed_by = excluded.removed_by, removed_at = excluded.removed_at
  where conversation_members.state <> 'removed';
  if v_was_active then
    perform public.group_recount_members(p_group);
    if to_regclass('public.notifications') is not null then
      insert into notifications (user_id, kind, conversation_id) values (p_user, 'group_member_removed', p_group);
    end if;
  end if;
end;
$$;

-- Lifts the removal: the member previews and may join again.
create or replace function public.readmit_member(p_group uuid, p_user uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if not public.can_manage_group(p_group) then
    raise exception 'forbidden';
  end if;
  delete from group_removals where group_id = p_group and user_id = p_user;
  delete from conversation_members where conversation_id = p_group and user_id = p_user and state = 'removed';
end;
$$;

create or replace function public.set_group_notify(p_group uuid, p_notify boolean)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  update conversation_members set notify = coalesce(p_notify, false)
  where conversation_id = p_group and user_id = auth.uid() and state = 'active';
  if not found then
    raise exception 'not_a_member';
  end if;
end;
$$;

-- Visible groups, latest activity first, cursor on last_activity_at. The query matches
-- the original name and description, and their translation into p_locale, which is
-- returned when there is one.
create or replace function public.search_groups(
  p_query text default null,
  p_locale text default null,
  p_limit int default 30,
  p_before timestamptz default null
)
returns table (
  group_id uuid,
  name text,
  description text,
  image_path text,
  member_count int,
  last_activity_at timestamptz,
  is_member boolean
)
language sql stable security definer set search_path = public
as $$
  with q as (
    select case when nullif(btrim(coalesce(p_query, '')), '') is not null
      then websearch_to_tsquery('simple', p_query) end as tsq
  )
  select g.conversation_id, coalesce(t.name, g.name), coalesce(t.description, g.description),
    g.image_path, g.member_count, g.last_activity_at,
    exists (select 1 from conversation_members cm
            where cm.conversation_id = g.conversation_id and cm.user_id = auth.uid() and cm.state = 'active')
  from groups g
  cross join q
  left join group_translations t on t.group_id = g.conversation_id and t.locale = p_locale
  where g.status = 'visible'
    and auth.uid() is not null
    and (p_before is null or g.last_activity_at < p_before)
    and (q.tsq is null
         or g.search @@ q.tsq
         or to_tsvector('simple', coalesce(t.name, '') || ' ' || coalesce(t.description, '')) @@ q.tsq)
  order by g.last_activity_at desc, g.conversation_id
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- Active members, the creator first, blocked members left out. Members only.
create or replace function public.list_conversation_members(
  p_conversation uuid,
  p_query text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (user_id uuid, role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_q text := lower(nullif(btrim(coalesce(p_query, '')), ''));
begin
  if not public.is_conversation_member(p_conversation) then
    raise exception 'forbidden';
  end if;
  return query
  select cm.user_id, cm.role, cm.joined_at
  from conversation_members cm
  join profiles p on p.id = cm.user_id
  where cm.conversation_id = p_conversation and cm.state = 'active'
    and not (cm.user_id = any (public.blocked_member_ids()))
    and (v_q is null or position(v_q in lower(coalesce(p.username, ''))) > 0)
  order by cm.role = 'creator' desc, cm.joined_at, cm.user_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Online members per group (first 100 ids, groups the caller may read): within the
-- presence grace window, visible, not banned, not blocked either way. 0 for every group
-- without the presence module.
create or replace function public.group_online_counts(p_groups uuid[])
returns table (group_id uuid, online int)
language plpgsql stable security definer set search_path = public
as $$
begin
  if to_regclass('public.member_presence') is null then
    return query select gid, 0 from unnest(p_groups[1:100]) gid;
    return;
  end if;
  return query
  select gid, (
    select count(*)::int
    from conversation_members cm
    join member_presence mp on mp.user_id = cm.user_id
    join profiles p on p.id = cm.user_id
    where cm.conversation_id = gid and cm.state = 'active'
      and mp.visible and not p.is_banned
      and mp.last_active_at > now() - make_interval(
        mins => coalesce((select grace_minutes from presence_settings), 5))
      and not (cm.user_id = any (public.blocked_member_ids()))
  )
  from unnest(p_groups[1:100]) gid
  where public.can_read_conversation(gid);
end;
$$;

-- ============ DASHBOARD ============
create or replace function public.admin_transfer_group(p_group uuid, p_new_creator uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if not public.messaging_is_dashboard_admin() then
    raise exception 'forbidden';
  end if;
  update groups set created_by = p_new_creator where conversation_id = p_group and status <> 'deleted';
  if not found then
    raise exception 'not_found';
  end if;
  update conversation_members set role = 'member'
  where conversation_id = p_group and role = 'creator' and user_id <> p_new_creator;
  insert into conversation_members (conversation_id, user_id, role) values (p_group, p_new_creator, 'creator')
  on conflict (conversation_id, user_id) do update set
    role = 'creator', state = 'active', removed_by = null, removed_at = null;
  delete from group_removals where group_id = p_group and user_id = p_new_creator;
  perform public.group_recount_members(p_group);
end;
$$;

-- Writes the live values directly (null keeps a field), past moderation.
create or replace function public.admin_edit_group(p_group uuid, p_name text, p_description text, p_image_path text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if not public.messaging_is_dashboard_admin() then
    raise exception 'forbidden';
  end if;
  update groups set
    name = coalesce(nullif(btrim(p_name), ''), name),
    description = case when p_description is null then description else nullif(btrim(p_description), '') end,
    image_path = coalesce(p_image_path, image_path)
  where conversation_id = p_group;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

-- ============ ACTIVITY ============
create or replace function public.groups_touch_activity()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update groups set last_activity_at = now() where conversation_id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists groups_touch_activity on public.messages;
create trigger groups_touch_activity
  after insert on public.messages
  for each row execute function public.groups_touch_activity();

-- ============ INBOX ============
-- group_approved, group_field_rejected and group_member_removed name their group.
do $$
begin
  if to_regclass('public.notifications') is not null then
    alter table public.notifications
      add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
  end if;
end $$;

-- ============ REPORTS ============
-- A member reports a group they can read, naming its creator.
alter table public.reports
  add column if not exists group_id uuid references public.groups(conversation_id) on delete set null;
create index if not exists reports_group_idx on public.reports (group_id) where group_id is not null;
drop policy if exists "report a readable group" on public.reports;
create policy "report a readable group" on public.reports
  as restrictive for insert to authenticated
  with check (
    group_id is null
    or exists (
      select 1 from public.groups g
      where g.conversation_id = reports.group_id and g.created_by = reports.reported_user_id
    )
  );

-- ============ STORAGE ============
-- Public bucket: image_path only ever holds an approved image. A pending image lives
-- under `pending/<uid>/<uuid>.<ext>`, read through signed URLs by its uploader and by
-- moderation (service role), which moves it on approval.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('group-images', 'group-images', true, 2097152,
          array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

drop policy if exists "group image upload to own pending folder" on storage.objects;
create policy "group image upload to own pending folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'group-images'
    and (storage.foldername(name))[1] = 'pending'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
drop policy if exists "group image read by uploader" on storage.objects;
create policy "group image read by uploader" on storage.objects
  for select to authenticated
  using (bucket_id = 'group-images' and owner_id = auth.uid()::text);

-- ============ PROFILE MERGE ============
-- Called by merge_profiles (accounts/003). main keeps its row where both are members
-- (the earliest joined_at, notify OR-ed, creator if either was); likes deduplicated
-- with like_count kept in step; member counts recounted.
create or replace function public.merge_messaging(p_main uuid, p_other uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_groups uuid[];
begin
  select coalesce(array_agg(conversation_id), '{}') into v_groups
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

  update groups set created_by = p_main where created_by = p_other;
  delete from group_removals o where o.user_id = p_other
    and exists (select 1 from group_removals m where m.group_id = o.group_id and m.user_id = p_main);
  update group_removals set user_id = p_main where user_id = p_other;
  update group_removals set removed_by = p_main where removed_by = p_other;

  perform public.group_recount_members(g) from unnest(v_groups) g;
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
revoke execute on function public.can_manage_group(uuid) from public, anon;
revoke execute on function public.group_recount_members(uuid) from public, anon, authenticated;
revoke execute on function public.group_joined_count(uuid) from public, anon, authenticated;
revoke execute on function public.group_check_fields(text, text, text) from public, anon, authenticated;
revoke execute on function public.create_group(text, text, text) from public, anon;
revoke execute on function public.edit_group(uuid, text, text, text) from public, anon;
revoke execute on function public.delete_group(uuid) from public, anon;
revoke execute on function public.join_group(uuid) from public, anon;
revoke execute on function public.leave_group(uuid) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
revoke execute on function public.readmit_member(uuid, uuid) from public, anon;
revoke execute on function public.set_group_notify(uuid, boolean) from public, anon;
revoke execute on function public.search_groups(text, text, int, timestamptz) from public, anon;
revoke execute on function public.list_conversation_members(uuid, text, int, int) from public, anon;
revoke execute on function public.group_online_counts(uuid[]) from public, anon;
revoke execute on function public.admin_transfer_group(uuid, uuid) from public, anon;
revoke execute on function public.admin_edit_group(uuid, text, text, text) from public, anon;
revoke execute on function public.groups_touch_activity() from public, anon, authenticated;
revoke execute on function public.merge_messaging(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.messaging_on_account_delete(uuid) from public, anon, authenticated;

grant execute on function public.can_manage_group(uuid) to authenticated;
grant execute on function public.create_group(text, text, text) to authenticated;
grant execute on function public.edit_group(uuid, text, text, text) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
grant execute on function public.join_group(uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.readmit_member(uuid, uuid) to authenticated;
grant execute on function public.set_group_notify(uuid, boolean) to authenticated;
grant execute on function public.search_groups(text, text, int, timestamptz) to authenticated;
grant execute on function public.list_conversation_members(uuid, text, int, int) to authenticated;
grant execute on function public.group_online_counts(uuid[]) to authenticated;
grant execute on function public.admin_transfer_group(uuid, uuid) to authenticated, service_role;
grant execute on function public.admin_edit_group(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.merge_messaging(uuid, uuid) to service_role;
grant execute on function public.messaging_on_account_delete(uuid) to service_role;
