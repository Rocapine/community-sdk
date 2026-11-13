-- community-sdk presence/001_presence.sql (schema v1)
-- Presence module: a green dot on online members, a live online count, and a
-- per-member switch to hide. The app calls touch_presence() while it is open; a
-- member is online when their last touch is within the project's grace window
-- (presence_settings, default 5 minutes).
--
-- The timestamp is never readable by clients (only user_id and visible are, and
-- only for the member's own row): readers get a boolean through online_member_ids()
-- or a number through online_member_count(). Both skip banned and (for the ids)
-- hidden and mutually blocked members. The caller always counts as online (whoever
-- calls the readers has the app open), even before their first touch lands.
-- Fully idempotent.

create table if not exists public.member_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_active_at timestamptz not null default now(),
  visible boolean not null default true
);

create index if not exists member_presence_last_active_idx
  on public.member_presence (last_active_at);

alter table public.member_presence enable row level security;

-- A member reads only their own row, and only these columns (user_id because the
-- owner filters on it: column privileges apply to WHERE columns too).
drop policy if exists "read own presence" on public.member_presence;
create policy "read own presence" on public.member_presence
  for select to authenticated using (user_id = auth.uid());

revoke all on public.member_presence from public, anon, authenticated;
grant select (user_id, visible) on public.member_presence to authenticated;

create or replace function public.touch_presence()
returns void
language sql security definer set search_path = public
as $$
  insert into member_presence (user_id, last_active_at)
  select auth.uid(), now()
  where auth.uid() is not null
  on conflict (user_id) do update set last_active_at = excluded.last_active_at;
$$;

create or replace function public.set_presence_visible(p_visible boolean)
returns void
language sql security definer set search_path = public
as $$
  insert into member_presence (user_id, visible)
  select auth.uid(), p_visible
  where auth.uid() is not null
  on conflict (user_id) do update set visible = excluded.visible;
$$;

-- The grace window is a per-project setting, never a client parameter: if callers
-- chose it, sweeping 1..60 would tell them when each member was last active.
-- One row, readable only by the security definer RPCs below. Change it from the
-- SQL editor (service role): select public.presence_set_grace_minutes(10);
create table if not exists public.presence_settings (
  id boolean primary key default true check (id),
  grace_minutes int not null default 5 check (grace_minutes between 1 and 60)
);
insert into public.presence_settings (id) values (true) on conflict do nothing;
alter table public.presence_settings enable row level security;
revoke all on public.presence_settings from public, anon, authenticated;

-- The check constraint rejects values outside 1..60.
create or replace function public.presence_set_grace_minutes(p_minutes int)
returns void
language sql security definer set search_path = public
as $$
  insert into presence_settings (id, grace_minutes) values (true, p_minutes)
  on conflict (id) do update set grace_minutes = excluded.grace_minutes;
$$;

-- Earlier drafts took the grace as a parameter.
drop function if exists public.online_member_count(int);
drop function if exists public.online_member_ids(uuid[], int);

-- Members online within the grace window, hidden members included: a count
-- reveals no one. The caller counts even without a fresh row (union dedups).
create or replace function public.online_member_count()
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int from (
    select mp.user_id
    from member_presence mp
    join profiles p on p.id = mp.user_id
    where not p.is_banned
      and mp.last_active_at > now() - make_interval(
        mins => coalesce((select grace_minutes from presence_settings), 5))
    union
    select p.id from profiles p where p.id = auth.uid() and not p.is_banned
  ) online;
$$;

-- Which of the first 200 of p_ids are online, visible, not banned and not
-- blocked either way with the caller. The caller is online when asking, unless
-- they hid themselves (a missing row means visible).
create or replace function public.online_member_ids(p_ids uuid[])
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(id), '{}') from (
    select mp.user_id as id
    from member_presence mp
    join profiles p on p.id = mp.user_id
    where mp.user_id = any (p_ids[1:200])
      and mp.visible
      and not p.is_banned
      and mp.last_active_at > now() - make_interval(
        mins => coalesce((select grace_minutes from presence_settings), 5))
      and not (mp.user_id = any ((select public.blocked_member_ids())::uuid[]))
    union
    select p.id
    from profiles p
    left join member_presence mp on mp.user_id = p.id
    where p.id = auth.uid()
      and p.id = any (p_ids[1:200])
      and not p.is_banned
      and coalesce(mp.visible, true)
  ) online;
$$;

revoke execute on function public.touch_presence() from public, anon;
revoke execute on function public.set_presence_visible(boolean) from public, anon;
revoke execute on function public.online_member_count() from public, anon;
revoke execute on function public.online_member_ids(uuid[]) from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.set_presence_visible(boolean) to authenticated;
grant execute on function public.online_member_count() to authenticated;
grant execute on function public.online_member_ids(uuid[]) to authenticated;
revoke execute on function public.presence_set_grace_minutes(int) from public, anon, authenticated;
grant execute on function public.presence_set_grace_minutes(int) to service_role;
