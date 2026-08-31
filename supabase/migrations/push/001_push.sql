-- community-sdk push/001_push.sql (schema v1)
-- Community SDK — push module (OPTIONAL): comment + like notifications.
-- Skip this module entirely if the app does not ship community push.
-- References core module tables (public.profiles, public.likes) — the core
-- module must be installed first. likes.notified_at (core/001_tables.sql)
-- simply stays unused if this module is skipped.
--
-- This file: push_tokens storage + RLS. The webhook functions, triggers and
-- cron digest job (which embed the project URL / anon key) live in
-- push/002_triggers.sql.

-- Owner-only token+prefs table (a push token must NOT live on the
-- world-readable profiles table).
create table public.push_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  expo_push_token text,
  notify_likes boolean not null default true,
  notify_comments boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.push_tokens enable row level security;

create policy "read own push row" on public.push_tokens for select to authenticated
  using (user_id = auth.uid());
create policy "insert own push row" on public.push_tokens for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own push row" on public.push_tokens for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Like coalescing marker index (column lives in core/001_tables.sql).
create index likes_unnotified_idx on public.likes (post_id) where notified_at is null;
