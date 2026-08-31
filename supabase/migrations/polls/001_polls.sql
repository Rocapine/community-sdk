-- community-sdk polls/001_polls.sql (schema v1)
-- Community SDK — polls module (OPTIONAL): a post can carry 2-4 short
-- options (the post content is the question). One vote per user per poll,
-- changeable. Votes are anonymous at the API level: poll_votes is readable
-- only by its owner, aggregate counts go through the security-definer
-- poll_vote_counts(). Skip this module if the app does not ship polls
-- (and set the app's dashboard feature flag accordingly).
-- References core module tables (public.posts, public.profiles,
-- public.current_user_banned()) — the core module must be installed first.

-- ============ POLL OPTIONS ============
create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  idx smallint not null check (idx between 0 and 3),
  label text not null check (char_length(label) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (post_id, idx),
  -- Composite FK target so a vote's option is forced to belong to the same
  -- post the vote points at (see poll_votes).
  unique (id, post_id)
);

-- ============ POLL VOTES ============
create table public.poll_votes (
  post_id uuid not null references public.posts(id) on delete cascade,
  option_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  foreign key (option_id, post_id) references public.poll_options(id, post_id) on delete cascade
);
create index poll_votes_counts_idx on public.poll_votes (post_id, option_id);

-- ============ RLS ============
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

-- Options follow their post's visibility: the subquery runs under the caller's
-- posts RLS, so options of hidden posts / blocked authors stay invisible too.
create policy "poll options follow post visibility"
  on public.poll_options for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

create policy "insert options on own post if not banned"
  on public.poll_options for insert to authenticated
  with check (
    not public.current_user_banned()
    and exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );
-- No update/delete policies: options are immutable once posted.

-- Votes are private: only the voter reads her own row (the app uses it for
-- "my choice"); everyone else only ever sees aggregates.
create policy "read own poll votes"
  on public.poll_votes for select to authenticated
  using (user_id = auth.uid());

create policy "vote as self on a readable post"
  on public.poll_votes for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.current_user_banned()
    and exists (select 1 from public.posts p where p.id = post_id)
  );

-- Changing your vote = updating option_id on your own row (client upsert).
create policy "change own vote"
  on public.poll_votes for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============ VOTE COUNTS ============
-- Per-option counts for a batch of posts (one call per feed page).
-- SECURITY DEFINER bypasses the private poll_votes RLS but returns counts only.
create or replace function public.poll_vote_counts(p_post_ids uuid[])
returns table (post_id uuid, option_id uuid, votes bigint)
language sql stable security definer set search_path = public
as $$
  select v.post_id, v.option_id, count(*)::bigint
  from poll_votes v
  where v.post_id = any(p_post_ids)
  group by v.post_id, v.option_id;
$$;

revoke execute on function public.poll_vote_counts(uuid[]) from public, anon;
grant execute on function public.poll_vote_counts(uuid[]) to authenticated;

-- ============ POLL POST CREATION ============
-- Post + options in one transaction (no orphan post if an option insert
-- fails). SECURITY INVOKER: posts/poll_options RLS applies, so the banned
-- check and the pending-only insert status hold exactly as for a plain insert.
create or replace function public.create_poll_post(
  p_topic text,
  p_content text,
  p_options text[]
) returns uuid
language plpgsql set search_path = public
as $$
declare
  new_id uuid;
  n int := coalesce(array_length(p_options, 1), 0);
  i int;
begin
  if n < 2 or n > 4 then
    raise exception 'a poll needs 2 to 4 options';
  end if;
  insert into public.posts (author_id, topic, content)
    values (auth.uid(), p_topic, p_content)
    returning id into new_id;
  for i in 1..n loop
    insert into public.poll_options (post_id, idx, label)
      values (new_id, i - 1, p_options[i]);
  end loop;
  return new_id;
end;
$$;

revoke execute on function public.create_poll_post(text, text, text[]) from public, anon;
grant execute on function public.create_poll_post(text, text, text[]) to authenticated;
