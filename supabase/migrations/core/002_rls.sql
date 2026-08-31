-- community-sdk core/002_rls.sql (schema v1)
-- Community SDK — 02 RLS + grants (final state).
-- The client never filters blocked/hidden content itself; these policies are
-- the single enforcement point. Publication is gated server-side: clients can
-- ONLY insert 'pending' content, promotion to 'visible' is done by the
-- moderation Edge Functions (service role).

alter table public.profiles enable row level security;
alter table public.posts    enable row level security;
alter table public.comments enable row level security;
alter table public.likes    enable row level security;
alter table public.blocks   enable row level security;
alter table public.reports  enable row level security;

-- Helper: is the current user banned? Missing profile counts as banned.
create or replace function public.current_user_banned()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_banned from profiles where id = auth.uid()), true);
$$;

create or replace function public.current_user_official()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_official from profiles where id = auth.uid()), false);
$$;

-- ============ PROFILES ============
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);

create policy "update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and is_banned = false); -- no self-unban

-- Users may only write display/identity fields. is_banned is not updatable
-- by users at all; handle/bio/avatar_url are written exclusively by the
-- update-profile Edge Function (service role) so they are always moderated.
revoke update on table public.profiles from authenticated;
grant update (username, amplitude_id, revenuecat_id) on table public.profiles to authenticated;

-- Column-scoped select: the RLS policy above only decides which ROWS are
-- visible, not which COLUMNS — PostgREST otherwise happily returns every
-- column, including amplitude_id/revenuecat_id/is_banned/is_house, to any
-- authenticated (or anon, before the policy's `to authenticated` even
-- applies at the grant level) caller. The client only ever reads the public
-- identity surface (service.ts FEED_SELECT/PROFILE_SELECT, plus the
-- update-profile Edge Function payloads) — is_official stays readable, it's
-- the UI's "official" seal.
revoke select on public.profiles from anon, authenticated;
grant select (id, username, handle, bio, avatar_url, is_official, created_at)
  on public.profiles to anon, authenticated;

-- ============ POSTS ============
-- The heart of blocking: blocked authors' posts vanish from every query.
create policy "read visible posts, minus blocked authors"
  on public.posts for select to authenticated
  using (
    author_id = auth.uid()  -- authors always see their own posts (even hidden)
    or (
      status = 'visible'
      and not exists (
        select 1 from public.blocks b
        where b.blocker_id = auth.uid() and b.blocked_id = posts.author_id
      )
    )
  );

-- pending-only insert + the news guard: a tampered client can neither
-- self-publish nor post under the brand channel.
create policy "insert own posts if not banned"
  on public.posts for insert to authenticated
  with check (
    author_id = auth.uid()
    and not public.current_user_banned()
    and status = 'pending'
    and (topic is distinct from 'news' or public.current_user_official())
  );

create policy "author can soft-delete own post"
  on public.posts for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and status = 'deleted'); -- only allowed change

-- Column-scoped grants: the app only ever inserts (author_id, topic, content);
-- id/status/created_at come from defaults. Without this, a tampered client
-- could pre-set pinned_at or stamp the moderation trail at insert time.
revoke insert on table public.posts from authenticated;
grant insert (author_id, topic, content) on table public.posts to authenticated;
-- Authors may only write status (soft delete); content and the moderation
-- trail stay immutable from the client.
revoke update on table public.posts from authenticated;
grant update (status) on table public.posts to authenticated;

-- ============ COMMENTS ============ (same rules)
create policy "read visible comments, minus blocked authors"
  on public.comments for select to authenticated
  using (
    author_id = auth.uid()
    or (
      status = 'visible'
      and not exists (
        select 1 from public.blocks b
        where b.blocker_id = auth.uid() and b.blocked_id = comments.author_id
      )
    )
  );

create policy "insert own comments if not banned"
  on public.comments for insert to authenticated
  with check (
    author_id = auth.uid() and not public.current_user_banned() and status = 'pending'
  );

create policy "author can soft-delete own comment"
  on public.comments for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and status = 'deleted');

revoke insert on table public.comments from authenticated;
grant insert (post_id, author_id, content) on table public.comments to authenticated;
revoke update on table public.comments from authenticated;
grant update (status) on table public.comments to authenticated;

-- ============ LIKES ============
-- Only readable where the underlying post is readable, so the like graph of
-- hidden/deleted/blocked posts does not leak. The subquery on posts runs
-- under the posts RLS of the querying user.
create policy "likes readable where post readable"
  on public.likes for select to authenticated
  using (exists (select 1 from public.posts p where p.id = likes.post_id));

create policy "like as self" on public.likes for insert to authenticated
  with check (user_id = auth.uid() and not public.current_user_banned());

create policy "unlike as self" on public.likes for delete to authenticated
  using (user_id = auth.uid());

-- ============ BLOCKS ============
create policy "manage own blocks" on public.blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- ============ REPORTS ============
create policy "report as self" on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());
-- No SELECT for users: reports are read via service role / dashboard only.

-- ============ RPC SURFACE HYGIENE ============
-- generate_handle is internal to the assign trigger (security definer, owner
-- keeps execute); no client needs to call it.
revoke execute on function public.generate_handle(text) from public, anon, authenticated;
