-- community-sdk accounts/003_markers_and_bans.sql (schema v1)
-- Patch of accounts/001 and 002, which stay as released. Sets core/021's profile markers and keeps a
-- ban across account deletion:
--   account_bans           (provider, hash of the subject) of each banned account that was deleted, and
--                          the profile it was deleted from. Never the subject in clear.
--   account_link_and_merge also sets merged_into = p_main on each merged profile (and on any profile
--                          already merged into one of them), and bans p_main, with one moderation
--                          action, when the account is in account_bans.
--   account_delete_profile also stamps account_deleted_at and, when the profile is banned, adds each
--                          of its account links to account_bans (account-delete unlinks after it).
--   account_unban          drops the account_bans rows of a profile: its links' and those it was
--                          deleted from. The dashboard calls it when it unbans the profile.
-- Bodies are 001's / 002's otherwise. merge_profiles is not redefined. Service-role only. Requires
-- core/021. Fully idempotent.

create table if not exists public.account_bans (
  provider text not null,
  subject_hash text not null,
  -- The profile the account was deleted from (no foreign key: merge_profiles never moves it), so the
  -- dashboard can lift the ban once the link is gone.
  profile_id uuid not null,
  banned_at timestamptz not null default now(),
  primary key (provider, subject_hash)
);
create index if not exists account_bans_profile_idx on public.account_bans (profile_id);
alter table public.account_bans enable row level security;
revoke all on table public.account_bans from public, anon, authenticated;

-- The ban key of an account: sha256 of 'provider:subject', hex.
create or replace function public.account_ban_hash(p_provider text, p_subject text)
returns text
language sql immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(p_provider || ':' || p_subject, 'sha256'), 'hex');
$$;

-- Links (provider, subject) to p_main if the link is missing, then merges each p_merge profile into
-- it, all in one transaction. True when the link is new. Raises unique_violation, merging nothing,
-- when the account is linked to another profile or p_main to another account.
-- Each merged profile is marked merged_into = p_main. A banned account that was deleted bans p_main.
create or replace function public.account_link_and_merge(p_provider text, p_subject text, p_main uuid, p_merge uuid[])
returns boolean
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  inserted int;
  x uuid;
begin
  insert into public.account_links (provider, subject, profile_id)
  values (p_provider, p_subject, p_main)
  on conflict (provider, subject) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 and not exists (select 1 from public.account_links
      where provider = p_provider and subject = p_subject and profile_id = p_main) then
    raise exception 'account_link_and_merge: the account is linked to another profile'
      using errcode = 'unique_violation';
  end if;
  foreach x in array coalesce(p_merge, '{}') loop
    perform public.merge_profiles(p_main, x);
    if x <> p_main then
      -- A profile merged into x earlier follows it, so no marker points at an emptied profile.
      perform set_config('community.trusted', 'on', true);
      update public.profiles set merged_into = p_main where id = x or merged_into = x;
      perform set_config('community.trusted', '', true);
    end if;
  end loop;
  -- The ban stays in account_bans until the dashboard lifts it (account_unban): an account banned
  -- once is banned on every profile it comes back on. Not banned already, so one action per return.
  if exists (select 1 from public.account_bans
             where provider = p_provider and subject_hash = public.account_ban_hash(p_provider, p_subject))
     and not (select is_banned from public.profiles where id = p_main) then
    perform set_config('community.trusted', 'on', true);
    update public.profiles set is_banned = true where id = p_main;
    perform set_config('community.trusted', '', true);
    insert into public.moderation_actions (actor_email, action, target_user_id, note)
    values ('account ban', 'ban', p_main, 'banned account came back');
  end if;
  return inserted > 0;
end;
$$;

-- Account deletion, step one: resets the profile's identity, host ids, badges and streak, drops its push
-- rows and revokes every session (auth.refresh_tokens cascade), in one transaction. The edge function
-- then unlinks. Stamps account_deleted_at (the first deletion's, on a retry) and, when the profile is
-- banned, keeps the ban of each linked account in account_bans.
create or replace function public.account_delete_profile(p_profile uuid)
returns void
language plpgsql volatile security definer
set search_path = public, extensions
as $$
begin
  if (select is_banned from public.profiles where id = p_profile) then
    insert into public.account_bans (provider, subject_hash, profile_id)
    select provider, public.account_ban_hash(provider, subject), p_profile
      from public.account_links where profile_id = p_profile
    on conflict (provider, subject_hash) do update set profile_id = excluded.profile_id;
  end if;
  perform public.reset_profile_identity_for(p_profile);
  -- The host's ids go too: a candidates hook keyed on them must never adopt this profile again.
  perform set_config('community.trusted', 'on', true);
  update public.profiles
     set revenuecat_id = null, amplitude_id = null, account_deleted_at = coalesce(account_deleted_at, now())
   where id = p_profile;
  -- The badges and the streak go back to a fresh profile's, so old posts stop showing them. Each
  -- module's columns only where installed (streaks/002's trigger keeps both forms in step).
  if exists (select 1 from pg_attribute
             where attrelid = 'public.profiles'::regclass and attname = 'badges' and not attisdropped) then
    update public.profiles set badges = '{}', hidden_badges = '{}' where id = p_profile;
  end if;
  if exists (select 1 from pg_attribute
             where attrelid = 'public.profiles'::regclass and attname = 'streak_started_at' and not attisdropped) then
    update public.profiles
       set streak_started_at = null, best_streak_days = null, show_streak = true, show_best_streak = true
     where id = p_profile;
  end if;
  perform set_config('community.trusted', '', true);
  if to_regclass('public.push_tokens') is not null then
    delete from public.push_tokens where user_id = p_profile;
  end if;
  -- Created by a later push migration.
  if to_regclass('public.push_devices') is not null then
    delete from public.push_devices where user_id = p_profile;
  end if;
  delete from auth.sessions where user_id = p_profile;
end;
$$;

-- Lifts a profile's account ban: the account comes back unbanned on its next profile. The profile's own
-- is_banned is the caller's (the dashboard's unban).
create or replace function public.account_unban(p_profile uuid)
returns void
language sql volatile security definer
set search_path = public, extensions
as $$
  delete from public.account_bans b
   where b.profile_id = p_profile
      or exists (select 1 from public.account_links l
                 where l.profile_id = p_profile and l.provider = b.provider
                   and public.account_ban_hash(l.provider, l.subject) = b.subject_hash);
$$;

revoke execute on function public.account_ban_hash(text, text) from public, anon, authenticated;
grant execute on function public.account_ban_hash(text, text) to service_role;
revoke execute on function public.account_unban(uuid) from public, anon, authenticated;
grant execute on function public.account_unban(uuid) to service_role;
