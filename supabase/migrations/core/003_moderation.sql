-- community-sdk core/003_moderation.sql (schema v1)
-- Community SDK — 03 moderation plumbing: daily cron batch + real-time report
-- webhook.
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

-- Real-time: forward each new report to the report-to-slack Edge Function.
create or replace function public.notify_report_webhook()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform net.http_post(
    url := '__SUPABASE_PROJECT_URL__/functions/v1/report-to-slack',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SUPABASE_ANON_KEY__'
    ),
    body := jsonb_build_object('record', to_jsonb(new))
  );
  return new;
end;
$$;

drop trigger if exists on_report_created on public.reports;
create trigger on_report_created
  after insert on public.reports
  for each row execute function public.notify_report_webhook();

-- Daily 08:00 UTC moderation batch. Wrapped defensively: cron.schedule
-- upserts by job name, but if a prior manual run already created the job
-- and this raises anyway, do not fail the whole migration on a rerun.
do $$
begin
  perform cron.schedule(
    'daily-moderation',
    '0 8 * * *',
    $cron$
    select net.http_post(
      url := '__SUPABASE_PROJECT_URL__/functions/v1/daily-moderation',
      headers := jsonb_build_object('Authorization', 'Bearer __SUPABASE_ANON_KEY__')
    );
    $cron$
  );
exception when others then
  if sqlerrm like '%already exists%' then
    raise notice 'cron job daily-moderation already scheduled, skipping';
  else
    raise;
  end if;
end;
$$;
