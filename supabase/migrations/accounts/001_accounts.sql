-- community-sdk accounts/001_accounts.sql (schema v1)
-- Optional module: one community profile per host-app account.
--   account_links          (provider, subject) -> profile, the only source of truth for ownership.
--   merge_profiles         moves everything of `other` onto `main`, then the caller deletes `other`.
--   account_link_and_merge links and merges in one transaction.
--   reset_profile_identity_for  core's reset_profile_identity for a given profile (account deletion).
--   account_hook_exists    tells the edge function which optional host SQL hooks are installed.
--   account_session_calls  rate-limit store of the account-session function.
-- Everything here is service-role only. Requires core. Fully idempotent.

create table if not exists public.account_links (
  provider text not null,
  subject text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (provider, subject),
  unique (profile_id)
);
alter table public.account_links enable row level security;
revoke all on table public.account_links from public, anon, authenticated;

create table if not exists public.account_session_calls (
  subject_hash text primary key,
  at timestamptz not null
);
alter table public.account_session_calls enable row level security;
revoke all on table public.account_session_calls from public, anon, authenticated;

-- Moves every row that references `other` onto `main`. Where a table is unique per member, main's
-- row wins and other's duplicate is dropped. Optional-module tables are skipped when absent.
-- New foreign keys to profiles(id) must be added here (supabase-tests/accounts.sql fails otherwise).
create or replace function public.merge_profiles(main uuid, other uuid)
returns void
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  m public.profiles;
  o public.profiles;
begin
  if main is null or other is null then
    raise exception 'merge_profiles: both profiles are required';
  end if;
  if main = other then
    return;
  end if;
  -- Fixed order, so two concurrent merges of the same pair cannot deadlock.
  perform 1 from public.profiles where id in (main, other) order by id for update;
  select * into m from public.profiles where id = main;
  select * into o from public.profiles where id = other;
  if m.id is null or o.id is null then
    raise exception 'merge_profiles: profile not found';
  end if;

  -- Content.
  update public.posts set author_id = main where author_id = other;
  update public.comments set author_id = main where author_id = other;
  update public.post_drafts set author_id = main where author_id = other;
  update public.moderation_actions set target_user_id = main where target_user_id = other;
  update public.reports set reporter_id = main where reporter_id = other;
  update public.reports set reported_user_id = main where reported_user_id = other;

  -- One row per (item, member).
  delete from public.likes l where l.user_id = other
    and exists (select 1 from public.likes x where x.post_id = l.post_id and x.user_id = main);
  update public.likes set user_id = main where user_id = other;

  -- comment_likes references auth.users, not profiles (core/010), but follows the member all the same.
  delete from public.comment_likes l where l.user_id = other
    and exists (select 1 from public.comment_likes x where x.comment_id = l.comment_id and x.user_id = main);
  update public.comment_likes set user_id = main where user_id = other;

  -- A block between the two would become a self-block.
  delete from public.blocks
   where (blocker_id = other and blocked_id = main) or (blocker_id = main and blocked_id = other);
  delete from public.blocks b where b.blocker_id = other
    and exists (select 1 from public.blocks x where x.blocker_id = main and x.blocked_id = b.blocked_id);
  update public.blocks set blocker_id = main where blocker_id = other;
  delete from public.blocks b where b.blocked_id = other
    and exists (select 1 from public.blocks x where x.blocker_id = b.blocker_id and x.blocked_id = main);
  update public.blocks set blocked_id = main where blocked_id = other;

  -- Optional modules.
  if to_regclass('public.notifications') is not null then
    delete from public.notifications
     where (user_id = main and actor_id = other) or (user_id = other and actor_id = main);
    update public.notifications set user_id = main where user_id = other;
    update public.notifications set actor_id = main where actor_id = other;
  end if;
  if to_regclass('public.notification_seen') is not null then
    delete from public.notification_seen where user_id = other
      and exists (select 1 from public.notification_seen where user_id = main);
    update public.notification_seen set user_id = main where user_id = other;
  end if;
  if to_regclass('public.notification_reads') is not null then
    delete from public.notification_reads r where r.user_id = other
      and exists (select 1 from public.notification_reads x where x.item_id = r.item_id and x.user_id = main);
    update public.notification_reads set user_id = main where user_id = other;
  end if;
  if to_regclass('public.poll_votes') is not null then
    delete from public.poll_votes v where v.user_id = other
      and exists (select 1 from public.poll_votes x where x.post_id = v.post_id and x.user_id = main);
    update public.poll_votes set user_id = main where user_id = other;
  end if;
  if to_regclass('public.post_reactions') is not null then
    delete from public.post_reactions r where r.user_id = other
      and exists (select 1 from public.post_reactions x where x.post_id = r.post_id and x.user_id = main);
    update public.post_reactions set user_id = main where user_id = other;
  end if;
  if to_regclass('public.member_presence') is not null then
    delete from public.member_presence where user_id = other
      and exists (select 1 from public.member_presence where user_id = main);
    update public.member_presence set user_id = main where user_id = other;
  end if;
  if to_regclass('public.push_tokens') is not null then
    delete from public.push_tokens where user_id = other
      and exists (select 1 from public.push_tokens where user_id = main);
    update public.push_tokens set user_id = main where user_id = other;
  end if;
  -- Created by a later push migration.
  if to_regclass('public.push_devices') is not null then
    delete from public.push_devices d where d.user_id = other
      and exists (select 1 from public.push_devices x where x.device_id = d.device_id and x.user_id = main);
    update public.push_devices set user_id = main where user_id = other;
  end if;

  -- Identity. handle stays main's; is_admin, is_official and is_house are never read from other.
  perform set_config('community.trusted', 'on', true);
  update public.profiles
     set is_banned = m.is_banned or o.is_banned,
         username = case when take then o.username else m.username end,
         username_set_by_user = m.username_set_by_user or take,
         bio = case when take then coalesce(o.bio, m.bio) else m.bio end,
         avatar_url = case when take then coalesce(o.avatar_url, m.avatar_url) else m.avatar_url end
    from (select not m.username_set_by_user and o.username_set_by_user as take) t
   where id = main;
  perform set_config('community.trusted', '', true);
end;
$$;

-- Same body as core's reset_profile_identity (009), for any profile instead of auth.uid().
create or replace function public.reset_profile_identity_for(p_profile uuid)
returns void
language plpgsql volatile security definer
set search_path = public, extensions
as $$
begin
  perform set_config('community.trusted', 'on', true);
  update public.profiles
     set username = default_username,
         handle = coalesce(public.default_handle_for(id, default_handle), handle),
         username_set_by_user = false,
         handle_set_by_user = false,
         bio = null,
         avatar_url = null
   where id = p_profile;
  perform set_config('community.trusted', '', true);
end;
$$;

-- True when the app installed the named optional hook (signatures: see the accounts docs).
create or replace function public.account_hook_exists(name text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case name
    when 'account_profile_candidates' then to_regprocedure('public.account_profile_candidates(text,text,jsonb)')
    when 'account_owns_profile' then to_regprocedure('public.account_owns_profile(uuid,jsonb)')
    when 'on_account_linked' then to_regprocedure('public.on_account_linked(uuid,text,text,jsonb)')
  end is not null;
$$;

-- Links (provider, subject) to p_main if the link is missing, then merges each p_merge profile into
-- it, all in one transaction. True when the link is new.
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
  foreach x in array coalesce(p_merge, '{}') loop
    perform public.merge_profiles(p_main, x);
  end loop;
  return inserted > 0;
end;
$$;

revoke execute on function public.merge_profiles(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reset_profile_identity_for(uuid) from public, anon, authenticated;
revoke execute on function public.account_hook_exists(text) from public, anon, authenticated;
revoke execute on function public.account_link_and_merge(text, text, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.merge_profiles(uuid, uuid) to service_role;
grant execute on function public.reset_profile_identity_for(uuid) to service_role;
grant execute on function public.account_hook_exists(text) to service_role;
grant execute on function public.account_link_and_merge(text, text, uuid, uuid[]) to service_role;
