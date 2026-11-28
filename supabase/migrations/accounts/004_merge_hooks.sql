-- community-sdk accounts/004_merge_hooks.sql (schema v1)
-- Patch of accounts/002, which stays as released: merge_profiles also hands the merged profile's
-- messaging data to main through merge_messaging() (groups module), when that is installed.
-- accounts/003 doesn't redefine merge_profiles; its account_link_and_merge calls this one.
-- The body is 002's otherwise. Service-role only, as in 001 (create or replace keeps the grants).
-- Fully idempotent.

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
    -- The preferences move, not the legacy token: it is other's device, which may sign out later.
    update public.push_tokens set user_id = main, expo_push_token = null where user_id = other;
  end if;
  -- Created by a later push migration. Other's devices are not main's: the signed-in device registers
  -- again on main (registerPushDevice after the transition), another device must not get main's pushes.
  if to_regclass('public.push_devices') is not null then
    delete from public.push_devices where user_id = other;
  end if;

  -- Messaging (memberships, messages, likes, created groups, removals), where installed.
  if to_regprocedure('public.merge_messaging(uuid,uuid)') is not null then
    perform public.merge_messaging(main, other);
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
  -- The member's name, bio and avatar must not stay on the profile left behind.
  perform public.reset_profile_identity_for(other);
  -- Nobody may act as the emptied profile any more: its sessions go (auth.refresh_tokens cascade).
  -- account-session mints the caller's new session on main after this, so the caller stays signed in.
  delete from auth.sessions where user_id = other;
end;
$$;
