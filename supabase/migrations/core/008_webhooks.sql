-- community-sdk core/008_webhooks.sql (schema v1)
-- Community SDK — 08 report webhook + daily moderation cron, built on the
-- project settings helpers (core/000_settings.sql). On an existing install
-- this replaces the function and job that carried the project URL baked in.

-- Real-time: forward each new report to the report-to-slack Edge Function.
create or replace function public.notify_report_webhook()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.community_call_function('report-to-slack', jsonb_build_object('record', to_jsonb(new)));
  return new;
end;
$$;

create or replace trigger on_report_created
  after insert on public.reports
  for each row execute function public.notify_report_webhook();

-- Daily 08:00 UTC moderation batch.
select public.community_schedule(
  'daily-moderation',
  '0 8 * * *',
  $cron$ select public.community_call_function('daily-moderation'); $cron$
);
