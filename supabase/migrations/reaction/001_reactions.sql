-- community-sdk reaction/001_reactions.sql (schema v1)
-- Community SDK — reaction module (OPTIONAL): a generic "I stand with you"
-- reaction on a post, one row per (post, user). Counts + push only — the
-- reaction carries no visible server-side content; any richer text a host
-- app attaches client-side (an encouragement, a note, a kind word) never
-- reaches this table.
--
-- References core module tables (public.posts, public.profiles,
-- public.current_user_banned()) — the core module must be installed first.
-- Optionally extends the push module's push_tokens table with a
-- notify_reactions preference column; that ALTER is guarded with
-- to_regclass() so this module installs cleanly without the push module (the
-- notify-reaction webhook below still fires either way — it is the Edge
-- Function's job to look up push_tokens if/when that module is present).
--
-- ⚠️ PLACEHOLDERS: before pushing, replace __SUPABASE_PROJECT_URL__ with the
-- app's project URL (https://<ref>.supabase.co) and __SUPABASE_ANON_KEY__ with
-- its anon key. The anon key is public by design (shipped inside the app
-- binary): the Edge Functions do privileged work through their own
-- service-role env, the JWT only passes verify_jwt.
--
-- The DO block below fails the migration loudly if the placeholders were not
-- replaced.
do $$ begin
  if '__SUPABASE_PROJECT_URL__' like '\_\_SUPABASE%' escape '\' then
    raise exception 'community-sdk: placeholders not substituted. Run: npx @rocapine/community init';
  end if;
end $$;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============ POST_REACTIONS ============
create table public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Push-module coalescing marker (harmless if the push module is skipped).
  notified_at timestamptz,
  primary key (post_id, user_id)
);

alter table public.post_reactions enable row level security;

-- Rows are private, like poll_votes: the client only ever selects its own
-- rows (e.g. "did I already react"); counts and the latest-reactor line for
-- the feed go through the security-definer post_reaction_summary() RPC below.
create policy "read own reactions" on public.post_reactions
  for select to authenticated using (user_id = auth.uid());

-- One reaction row per (post, user); reacting again is a local-only event.
-- No delete policy: a reaction is not retractable.
create policy "react own" on public.post_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.current_user_banned()
    and exists (select 1 from public.posts p where p.id = post_id)
  );

-- Per-post summary for a feed page: count, the display name of the most
-- recent reactor (null when they have not chosen a display name — the client
-- falls back to a generic label), and whether the caller has reacted.
-- SECURITY DEFINER only to join profiles.username and read auth.uid() across
-- rows that RLS would otherwise keep private to their own owner.
create or replace function public.post_reaction_summary(p_post_ids uuid[])
returns table (post_id uuid, reaction_count int, last_reactor_name text, has_reacted boolean)
language sql stable security definer set search_path = public
as $$
  select
    r.post_id,
    count(*)::int as reaction_count,
    (
      select pr.username
      from post_reactions r2
      join profiles pr on pr.id = r2.user_id
      where r2.post_id = r.post_id
      order by r2.created_at desc
      limit 1
    ) as last_reactor_name,
    bool_or(r.user_id = auth.uid()) as has_reacted
  from post_reactions r
  where r.post_id = any(p_post_ids)
  group by r.post_id;
$$;

revoke execute on function public.post_reaction_summary(uuid[]) from public, anon;
grant execute on function public.post_reaction_summary(uuid[]) to authenticated;

create index post_reactions_unnotified_idx on public.post_reactions (post_id) where notified_at is null;

-- Push preference (default on, same as likes/comments). Guarded so this
-- module installs cleanly without the push module (push_tokens missing).
do $$
begin
  if to_regclass('public.push_tokens') is not null then
    alter table public.push_tokens add column if not exists notify_reactions boolean not null default true;
  end if;
end $$;

-- ============ WEBHOOK + DIGEST ============
-- Same pattern as push/002_triggers.sql's notify-like: an immediate webhook
-- on insert plus a coalescing digest cron for anything the webhook missed.
-- Requires the notify-reaction Edge Function.
create or replace function public.notify_reaction_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := '__SUPABASE_PROJECT_URL__/functions/v1/notify-reaction',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer __SUPABASE_ANON_KEY__'),
    body := jsonb_build_object('record', to_jsonb(new))
  );
  return new;
end; $$;

create trigger on_post_reaction_created
  after insert on public.post_reactions
  for each row execute function public.notify_reaction_webhook();

-- Half-hourly digest: flush the tail of any coalesced reaction bursts.
do $$
begin
  perform cron.schedule(
    'community-reaction-digest', '30 * * * *',
    $cron$
    select net.http_post(
      url := '__SUPABASE_PROJECT_URL__/functions/v1/notify-reaction',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer __SUPABASE_ANON_KEY__')
    );
    $cron$
  );
exception when others then
  if sqlerrm like '%already exists%' then
    raise notice 'cron job community-reaction-digest already scheduled, skipping';
  else
    raise;
  end if;
end;
$$;
