-- Threaded replies and comment likes (after Eve's Rhythm's community v2).
--
-- Purely additive, safe for installed app versions: older clients never send
-- parent_id (null = a top-level comment) and never read comment_likes. A reply
-- is a comment whose parent_id points at the comment it answers; the app shows
-- replies one level deep, under their root comment.

-- ============ REPLIES ============
alter table public.comments
  add column if not exists parent_id uuid references public.comments(id) on delete set null;
create index if not exists comments_parent_idx
  on public.comments (parent_id) where parent_id is not null;

-- Column-scoped INSERT grant (002_rls.sql): add parent_id to what a client may
-- set. GRANT is additive, the other columns stay granted.
grant insert (parent_id) on table public.comments to authenticated;

-- A reply must answer a comment of the same post that the author can see.
-- SECURITY INVOKER on purpose: RLS hides hidden comments and blocked authors,
-- so one cannot reply to what one cannot read.
create or replace function public.comments_parent_same_post()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from comments c where c.id = new.parent_id and c.post_id = new.post_id
  ) then
    raise exception 'parent comment not found on this post' using errcode = '23503';
  end if;
  return new;
end; $$;

drop trigger if exists comments_parent_same_post on public.comments;
create trigger comments_parent_same_post
  before insert on public.comments
  for each row
  when (new.parent_id is not null)
  execute function public.comments_parent_same_post();

-- ============ COMMENT LIKES ============
-- One row per (comment, user), readable wherever the comment is readable,
-- written only as oneself. Likes on comments notify nobody.
--
-- user_id references auth.users, NOT public.profiles, on purpose: a
-- (comment_id, user_id) key with FKs to both comments and profiles is a
-- many-to-many junction to PostgREST, which would make every existing
-- `comments?select=profiles(...)` embed ambiguous (PGRST201) and break the
-- threads of installed app versions. Same ids either way: a profile's id is
-- its auth user's id.
create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists comment_likes_user_idx on public.comment_likes (user_id);

alter table public.comment_likes enable row level security;

drop policy if exists "comment likes readable where comment readable" on public.comment_likes;
create policy "comment likes readable where comment readable"
  on public.comment_likes for select to authenticated
  using (exists (select 1 from public.comments c where c.id = comment_likes.comment_id));

drop policy if exists "like comment as self" on public.comment_likes;
create policy "like comment as self"
  on public.comment_likes for insert to authenticated
  with check (user_id = auth.uid() and not public.current_user_banned());

drop policy if exists "unlike comment as self" on public.comment_likes;
create policy "unlike comment as self"
  on public.comment_likes for delete to authenticated
  using (user_id = auth.uid());

revoke all on table public.comment_likes from anon, authenticated;
grant select, delete on table public.comment_likes to authenticated;
grant insert (comment_id, user_id) on table public.comment_likes to authenticated;
