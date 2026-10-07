-- community-sdk reaction/002_webhooks.sql (schema v1)
-- Community SDK — reaction module: webhook + half-hourly digest, built on the
-- project settings helpers (core/000_settings.sql). Same pattern as
-- push/003_webhooks.sql's notify-like: an immediate webhook on insert plus a
-- coalescing digest cron for anything the webhook missed. Requires the
-- notify-reaction Edge Function. On an existing install this replaces the
-- function and job that carried the project URL baked in.
create or replace function public.notify_reaction_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.community_call_function('notify-reaction', jsonb_build_object('record', to_jsonb(new)));
  return new;
end; $$;

drop trigger if exists on_post_reaction_created on public.post_reactions;
create trigger on_post_reaction_created
  after insert on public.post_reactions
  for each row execute function public.notify_reaction_webhook();

-- Half-hourly digest: flush the tail of any coalesced reaction bursts.
select public.community_schedule(
  'community-reaction-digest',
  '30 * * * *',
  $cron$ select public.community_call_function('notify-reaction'); $cron$
);
