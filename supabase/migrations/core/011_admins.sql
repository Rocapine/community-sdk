-- community-sdk core/011_admins.sql (schema v1)
-- "Official" accounts become admin accounts (`profiles.is_admin`), and the
-- posts insert policy no longer reserves the 'news' topic: which topics only
-- admins post in is the app's `adminOnly` config, applied by the SDK's UI.
--
-- Expand step, for app versions on SDK 0.14 or older:
--  - `is_official` stays, read-only and always equal to `is_admin`;
--  - list_notifications still names admin posts `official_post` (the only kind
--    those versions know); SDK 0.15 reads it as `admin_post`.
-- Contract step, once no such version is in use: drop `is_official`, and return
-- `admin_post` from list_notifications.

alter table public.profiles rename column is_official to is_admin;
alter table public.profiles
  add column is_official boolean generated always as (is_admin) stored;
-- `is_admin` keeps the column grant `is_official` had (002_rls.sql).
grant select (is_official) on public.profiles to anon, authenticated;

create or replace function public.current_user_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

drop policy "insert own posts if not banned" on public.posts;
create policy "insert own posts if not banned"
  on public.posts for insert to authenticated
  with check (
    author_id = auth.uid()
    and not public.current_user_banned()
    and status = 'pending'
  );

drop function public.current_user_official();
