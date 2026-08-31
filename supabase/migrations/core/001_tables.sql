-- community-sdk core/001_tables.sql (schema v1)
-- Community SDK — 01 core schema.
-- Fresh-install consolidation of the community tables in their FINAL shape.
-- Extracted from Eve's Rhythm (supabase/migrations 20260708090000 → 20260729120000
-- on main); the resulting schema is identical, without the historical churn.

create extension if not exists unaccent;

-- ============ PROFILES ============
-- One row per auth user (anonymous ones included), created by trigger.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  -- Display name. NOT unique: apps may publish under real first names.
  username text,
  -- Stable public identity (slug-1234), assigned once by trigger when
  -- username first becomes non-null. Never client-writable.
  handle text unique,
  -- Moderated fields: the update-profile Edge Function is the ONLY write path.
  bio text check (char_length(bio) <= 300),
  avatar_url text,
  -- Optional links to the host app's analytics / IAP identities.
  amplitude_id text,
  revenuecat_id text,
  is_banned boolean not null default false,
  -- Team-run account: excluded from the dashboard's adoption metrics.
  is_house boolean not null default false,
  -- Verified seal in the app + right to post in the restricted news topic.
  is_official boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a profile for every new auth user (incl. anonymous ones).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- slug(base) + '-' + random 4-digit suffix; retries on collision and
-- widens to 6 digits after 5 collisions (guaranteed exit). VOLATILE so
-- the existence check sees rows already updated by the calling statement.
create or replace function public.generate_handle(base text)
returns text
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  slug text;
  candidate text;
  tries int := 0;
begin
  slug := lower(unaccent(coalesce(base, '')));
  slug := regexp_replace(slug, '[^a-z0-9]', '', 'g');
  slug := left(slug, 12);
  if slug = '' then
    slug := 'member';
  end if;
  loop
    if tries < 5 then
      candidate := slug || '-' || (floor(random() * 9000) + 1000)::int;
    else
      candidate := slug || '-' || (floor(random() * 900000) + 100000)::int;
    end if;
    exit when not exists (select 1 from public.profiles where handle = candidate);
    tries := tries + 1;
  end loop;
  return candidate;
end;
$$;

-- Assign once, the first time username becomes non-null. A later name change
-- never re-assigns the handle (stable identity).
create or replace function public.assign_handle()
returns trigger
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if new.handle is null and new.username is not null then
    new.handle := public.generate_handle(new.username);
  end if;
  return new;
end;
$$;

create trigger profiles_assign_handle
  before insert or update of username on public.profiles
  for each row execute function public.assign_handle();

-- ============ POSTS ============
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  -- Optional app-defined category (client-side vocabulary, no check).
  -- Convention: 'news' is reserved for official accounts (RLS-enforced).
  topic text,
  -- pending: awaiting moderation | visible: published |
  -- hidden: masked by moderation | deleted: by author (soft delete)
  status text not null default 'pending'
    check (status in ('pending', 'visible', 'hidden', 'deleted')),
  moderated_at timestamptz,          -- null = not yet seen by the AI batch
  moderation_reason text,            -- set by the AI when hidden
  -- Pinning is a dashboard (service role) operation; the feed orders by
  -- pinned_at desc nulls last.
  pinned_at timestamptz,
  -- Human review trail (dashboard).
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now()
);
create index posts_feed_idx on public.posts (status, created_at desc);
create index posts_moderation_idx on public.posts (created_at) where moderated_at is null;
create index posts_pinned_idx on public.posts (pinned_at desc) where pinned_at is not null;

-- ============ COMMENTS ============
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  status text not null default 'pending'
    check (status in ('pending', 'visible', 'hidden', 'deleted')),
  moderated_at timestamptz,
  moderation_reason text,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);
create index comments_moderation_idx on public.comments (created_at) where moderated_at is null;

-- ============ LIKES ============
create table public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Push-module coalescing marker (harmless if the push module is skipped).
  notified_at timestamptz,
  primary key (post_id, user_id)
);

-- ============ BLOCKS ============
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ============ REPORTS ============
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  comment_id uuid references public.comments(id) on delete set null,
  reason text not null check (reason in ('spam','harassment','hate','inappropriate','other')),
  details text,
  status text not null default 'open' check (status in ('open','resolved')),
  -- Dashboard resolution trail.
  resolved_at timestamptz,
  resolved_by text,
  resolution text check (resolution in ('content_hidden','rejected','user_banned')),
  created_at timestamptz not null default now(),
  check (post_id is not null or comment_id is not null)
);
