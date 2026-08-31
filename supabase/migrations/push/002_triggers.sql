-- community-sdk push/002_triggers.sql (schema v1)
-- Community SDK — push module (OPTIONAL): webhook functions, triggers and the
-- hourly digest cron job. Requires the notify-comment / notify-like Edge
-- Functions and an EXPO_ACCESS_TOKEN secret. References core module tables
-- (public.comments, public.likes) — the core module must be installed first,
-- and push/001_push.sql (push_tokens) before this file.
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

-- ============ WEBHOOK FUNCTIONS ============
create or replace function public.notify_comment_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := '__SUPABASE_PROJECT_URL__/functions/v1/notify-comment',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer __SUPABASE_ANON_KEY__'),
    body := jsonb_build_object('record', to_jsonb(new))
  );
  return new;
end; $$;

create or replace function public.notify_like_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := '__SUPABASE_PROJECT_URL__/functions/v1/notify-like',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer __SUPABASE_ANON_KEY__'),
    body := jsonb_build_object('record', to_jsonb(new))
  );
  return new;
end; $$;

-- ============ TRIGGERS ============
-- Notify the post author only once a comment is actually published, never on
-- the pending insert (a rejected comment must never send a push).
create trigger on_comment_published
  after update on public.comments
  for each row
  when (old.status = 'pending' and new.status = 'visible')
  execute function public.notify_comment_webhook();

-- Dashboard comments are inserted directly as 'visible' (service role) and
-- must notify too. App comments are always inserted 'pending' (RLS-enforced),
-- so nothing double-notifies.
create trigger on_comment_created_visible
  after insert on public.comments
  for each row
  when (new.status = 'visible')
  execute function public.notify_comment_webhook();

create trigger on_like_created
  after insert on public.likes
  for each row execute function public.notify_like_webhook();

-- Hourly digest: flush the tail of any coalesced like bursts.
do $$
begin
  perform cron.schedule(
    'community-like-digest', '0 * * * *',
    $cron$
    select net.http_post(
      url := '__SUPABASE_PROJECT_URL__/functions/v1/notify-like',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer __SUPABASE_ANON_KEY__')
    );
    $cron$
  );
exception when others then
  if sqlerrm like '%already exists%' then
    raise notice 'cron job community-like-digest already scheduled, skipping';
  else
    raise;
  end if;
end;
$$;
