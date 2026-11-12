-- community-sdk core/016_mutual_blocks.sql (schema v1)
-- A block now works both ways: once A blocks B, neither sees the other's posts,
-- comments, likes or profile, and neither can comment, reply or like on the
-- other's content. Until now only the blocker stopped seeing the blocked member,
-- who could still read the blocker and write under their posts, where everyone
-- but the blocker saw it.
--
-- Admin accounts are never hidden by a block (they are the app speaking): a block
-- toward an admin is refused, and one made before this migration is inert. A
-- member can unblock (delete their own block row) and list whom they blocked
-- (list_blocked_members()).
--
-- Additive for installed app versions: the same tables and columns, only fewer
-- rows. A blocked profile is no longer readable, so an older app shows its usual
-- error state on that profile.

create index if not exists blocks_blocked_idx on public.blocks (blocked_id, blocker_id);

-- The members hidden from the caller: the ones they blocked and the ones who
-- blocked them, admins excepted. SECURITY DEFINER because the blocks RLS only
-- shows a member their own rows, never the blocks against them. Policies call it
-- as `(select public.blocked_member_ids())::uuid[]` (one run per query; the cast keeps
-- `= any` reading an array, not a subquery). Reuse it
-- for anything that shows one member to another (online presence included).
-- A member can learn that someone blocked them by calling it; the mutual hiding
-- tells them anyway.
create or replace function public.blocked_member_ids()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(s.other), '{}')
  from (
    select b.blocked_id as other from blocks b where b.blocker_id = auth.uid()
    union
    select b.blocker_id from blocks b where b.blocked_id = auth.uid()
  ) s
  join profiles p on p.id = s.other
  where not p.is_admin;
$$;

revoke execute on function public.blocked_member_ids() from public, anon;
grant execute on function public.blocked_member_ids() to authenticated;

-- ============ PROFILES ============
drop policy "profiles readable by authenticated" on public.profiles;
create policy "profiles readable unless blocked"
  on public.profiles for select to authenticated
  using (id = auth.uid() or not (id = any ((select public.blocked_member_ids())::uuid[])));

-- ============ POSTS ============
drop policy "read visible posts, minus blocked authors" on public.posts;
create policy "read visible posts, minus blocked members"
  on public.posts for select to authenticated
  using (
    author_id = auth.uid()
    or (status = 'visible' and not (author_id = any ((select public.blocked_member_ids())::uuid[])))
  );

-- ============ COMMENTS ============
drop policy "read visible comments, minus blocked authors" on public.comments;
create policy "read visible comments, minus blocked members"
  on public.comments for select to authenticated
  using (
    author_id = auth.uid()
    or (status = 'visible' and not (author_id = any ((select public.blocked_member_ids())::uuid[])))
  );

-- A comment needs a post the author can read: not hidden, deleted, or by a
-- member blocked either way. A reply also needs a parent the author can read
-- (comments_parent_same_post, core/010, runs under this same RLS).
drop policy "insert own comments if not banned" on public.comments;
create policy "insert own comments if not banned"
  on public.comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and not public.current_user_banned()
    and status = 'pending'
    and exists (select 1 from public.posts p where p.id = post_id)
  );

-- ============ LIKES ============
drop policy "likes readable where post readable" on public.likes;
create policy "likes readable where post readable"
  on public.likes for select to authenticated
  using (
    exists (select 1 from public.posts p where p.id = likes.post_id)
    and not (user_id = any ((select public.blocked_member_ids())::uuid[]))
  );

drop policy "like as self" on public.likes;
create policy "like as self"
  on public.likes for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.current_user_banned()
    and exists (select 1 from public.posts p where p.id = post_id)
  );

-- ============ COMMENT LIKES ============
drop policy "comment likes readable where comment readable" on public.comment_likes;
create policy "comment likes readable where comment readable"
  on public.comment_likes for select to authenticated
  using (
    exists (select 1 from public.comments c where c.id = comment_likes.comment_id)
    and not (user_id = any ((select public.blocked_member_ids())::uuid[]))
  );

drop policy "like comment as self" on public.comment_likes;
create policy "like comment as self"
  on public.comment_likes for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.current_user_banned()
    and exists (select 1 from public.comments c where c.id = comment_id)
  );

-- ============ BLOCKS ============
drop policy "manage own blocks" on public.blocks;
create policy "read own blocks" on public.blocks for select to authenticated
  using (blocker_id = auth.uid());
create policy "unblock own blocks" on public.blocks for delete to authenticated
  using (blocker_id = auth.uid());
create policy "block a member, never an admin" on public.blocks for insert to authenticated
  with check (
    blocker_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = blocked_id and p.is_admin)
  );

-- Whom the caller blocked, newest first, for the "Blocked members" list.
-- SECURITY DEFINER: those profiles are no longer readable through RLS.
create or replace function public.list_blocked_members()
returns table (
  id uuid,
  username text,
  handle text,
  avatar_url text,
  blocked_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.username, p.handle, p.avatar_url, b.created_at
  from blocks b
  join profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;

revoke execute on function public.list_blocked_members() from public, anon;
grant execute on function public.list_blocked_members() to authenticated;
