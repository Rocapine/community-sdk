-- community-sdk streaks/001_streaks.sql (schema v1)
-- Streaks module: the host app's streak on each profile (a sobriety, habit or
-- practice streak), shown as a pill on posts and on the profile.
-- The client writes the raw values (when the current streak started, the best
-- streak in days) and two visibility toggles. Readers only ever see the
-- generated `visible_*` columns, null while the owner hides that value, so a
-- hidden streak never leaves the database. Fully idempotent.

alter table public.profiles
  add column if not exists streak_started_at timestamptz,
  add column if not exists best_streak_days int check (best_streak_days >= 0),
  add column if not exists show_streak boolean not null default true,
  add column if not exists show_best_streak boolean not null default true;

alter table public.profiles
  add column if not exists visible_streak_started_at timestamptz
    generated always as (case when show_streak then streak_started_at end) stored,
  add column if not exists visible_best_streak_days int
    generated always as (case when show_best_streak then best_streak_days end) stored;

-- Owners write their own row (RLS "update own profile"); the raw values stay
-- unreadable, everyone reads the visible ones and the toggles.
grant update (streak_started_at, best_streak_days, show_streak, show_best_streak)
  on table public.profiles to authenticated;
grant select (visible_streak_started_at, visible_best_streak_days, show_streak, show_best_streak)
  on public.profiles to anon, authenticated;
