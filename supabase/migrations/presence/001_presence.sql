-- community-sdk presence/001_presence.sql (schema v1)
-- Presence module: a green dot on online members, a live online count, and a
-- per-member switch to hide. The app calls touch_presence() while it is open; a
-- member is online when their last touch is within a grace window.
--
-- The timestamp is never readable by clients (only user_id and visible are, and
-- only for the member's own row): readers get a boolean through online_member_ids()
-- or a number through online_member_count(). Both skip banned and (for the ids)
-- hidden and mutually blocked members. Fully idempotent.

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

-- Members online within the grace window (clamped to 1..60 minutes), hidden
-- members included: a count reveals no one.
create or replace function public.online_member_count(p_grace_minutes int)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int
  from member_presence mp
  join profiles p on p.id = mp.user_id
  where not p.is_banned
    and mp.last_active_at
      > now() - make_interval(mins => least(greatest(p_grace_minutes, 1), 60));
$$;

-- Which of the first 200 of p_ids are online, visible, not banned and not
-- blocked either way with the caller.
create or replace function public.online_member_ids(p_ids uuid[], p_grace_minutes int)
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(mp.user_id), '{}')
  from member_presence mp
  join profiles p on p.id = mp.user_id
  where mp.user_id = any (p_ids[1:200])
    and mp.visible
    and not p.is_banned
    and mp.last_active_at
      > now() - make_interval(mins => least(greatest(p_grace_minutes, 1), 60))
    and not (mp.user_id = any ((select public.blocked_member_ids())::uuid[]));
$$;

revoke execute on function public.touch_presence() from public, anon;
revoke execute on function public.set_presence_visible(boolean) from public, anon;
revoke execute on function public.online_member_count(int) from public, anon;
revoke execute on function public.online_member_ids(uuid[], int) from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.set_presence_visible(boolean) to authenticated;
grant execute on function public.online_member_count(int) to authenticated;
grant execute on function public.online_member_ids(uuid[], int) to authenticated;
