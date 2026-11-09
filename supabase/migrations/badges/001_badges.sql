-- community-sdk badges/001_badges.sql (schema v1)
-- Badges module: app-defined badges on each profile (a streak, a pregnancy month,
-- a rank…), shown next to the author on posts and comments and on the profile.
-- The app writes `badges` (JSON keyed by its badge ids) for its own member; the
-- member writes `hidden_badges`, the ids they chose to hide. Readers only ever see
-- the generated `visible_badges`, so a hidden badge never leaves the database.
-- Client-written by design (the app computes the values on the device): a size and
-- shape check is the only guard. Fully idempotent.

alter table public.profiles
  add column if not exists badges jsonb not null default '{}'::jsonb,
  add column if not exists hidden_badges text[] not null default '{}';

alter table public.profiles drop constraint if exists profiles_badges_check;
alter table public.profiles add constraint profiles_badges_check
  check (jsonb_typeof(badges) = 'object' and octet_length(badges::text) <= 2048);

alter table public.profiles
  add column if not exists visible_badges jsonb
    generated always as (badges - hidden_badges) stored;

-- Owners write their own row (RLS "update own profile"); the raw values stay
-- unreadable, everyone reads the visible ones and the hidden ids (the toggles).
grant update (badges, hidden_badges) on table public.profiles to authenticated;
grant select (visible_badges, hidden_badges) on public.profiles to anon, authenticated;
