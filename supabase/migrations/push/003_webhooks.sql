-- community-sdk push/003_webhooks.sql (schema v1)
-- Community SDK — push module: webhook functions, triggers and the hourly
-- digest cron, built on the project settings helpers (core/000_settings.sql).
-- Requires the notify-comment / notify-like Edge Functions. On an existing
-- install this replaces the functions and job that carried the project URL
-- baked in.

-- ============ WEBHOOK FUNCTIONS ============
create or replace function public.notify_comment_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.community_call_function('notify-comment', jsonb_build_object('record', to_jsonb(new)));
  return new;
end; $$;

create or replace function public.notify_like_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.community_call_function('notify-like', jsonb_build_object('record', to_jsonb(new)));
  return new;
end; $$;

-- ============ TRIGGERS ============
-- Notify the post author only once a comment is actually published, never on
-- the pending insert (a rejected comment must never send a push).
create or replace trigger on_comment_published
  after update on public.comments
  for each row
  when (old.status = 'pending' and new.status = 'visible')
  execute function public.notify_comment_webhook();

-- Dashboard comments are inserted directly as 'visible' (service role) and
-- must notify too. App comments are always inserted 'pending' (RLS-enforced),
-- so nothing double-notifies.
create or replace trigger on_comment_created_visible
  after insert on public.comments
  for each row
  when (new.status = 'visible')
  execute function public.notify_comment_webhook();

create or replace trigger on_like_created
  after insert on public.likes
  for each row execute function public.notify_like_webhook();

-- Hourly digest: flush the tail of any coalesced like bursts.
select public.community_schedule(
  'community-like-digest',
  '0 * * * *',
  $cron$ select public.community_call_function('notify-like'); $cron$
);
