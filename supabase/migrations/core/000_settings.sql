-- community-sdk core/000_settings.sql (schema v1)
-- Community SDK — 00 project settings: where the pg_cron jobs and pg_net
-- webhooks learn this project's own URL and anon key.
--
-- They live in Supabase Vault, seeded ONCE PER PROJECT after `db push`:
--
--   select public.community_settings_set('https://<ref>.supabase.co', '<anon key>');
--
-- so the very same migration files deploy to a sandbox and a production
-- project. The anon key is public by design (it ships inside the app binary):
-- the Edge Functions do privileged work through their own service-role env,
-- the JWT only passes verify_jwt.
--
-- Every helper here is security definer and private (postgres + service_role):
-- the webhook trigger functions are security definer too, cron runs as
-- postgres, and nothing is exposed over PostgREST.

create extension if not exists supabase_vault;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Upsert both settings. Idempotent: re-run it to rotate the key or move the
-- project.
create or replace function public.community_settings_set(p_project_url text, p_anon_key text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
  v_value text;
begin
  for v_name, v_value in
    values ('community_project_url', rtrim(p_project_url, '/')), ('community_anon_key', p_anon_key)
  loop
    select id into v_id from vault.secrets where name = v_name;
    if v_id is null then
      perform vault.create_secret(v_value, v_name);
    else
      perform vault.update_secret(v_id, v_value);
    end if;
  end loop;
end;
$$;

create or replace function public.community_setting(p_name text)
returns text
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  v_value text;
begin
  select decrypted_secret into v_value from vault.decrypted_secrets where name = p_name;
  if v_value is null then
    raise exception 'community-sdk: project setting % is not seeded. Run once per project: select public.community_settings_set(''https://<ref>.supabase.co'', ''<anon key>'');', p_name;
  end if;
  return v_value;
end;
$$;

create or replace function public.community_project_url()
returns text language sql stable security definer set search_path = ''
as $$ select public.community_setting('community_project_url') $$;

create or replace function public.community_anon_key()
returns text language sql stable security definer set search_path = ''
as $$ select public.community_setting('community_anon_key') $$;

-- Call one of this project's own Edge Functions through pg_net. A failure
-- (settings not seeded, pg_net unavailable) is logged as a warning and never
-- aborts the insert/update that triggered it: the content stays `pending`
-- (or untranslated) and the daily sweep catches up.
create or replace function public.community_call_function(p_function text, p_body jsonb default null)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := public.community_project_url() || '/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.community_anon_key()
    ),
    body := coalesce(p_body, '{}'::jsonb)
  );
exception when others then
  raise warning 'community-sdk: could not call Edge Function %: %', p_function, sqlerrm;
end;
$$;

-- (Re)schedule a cron job by name: replaces an existing job of the same name,
-- so a re-run (or an upgrade from a release that baked the URL into the job
-- command) always ends with exactly one job carrying the current command.
create or replace function public.community_schedule(p_name text, p_schedule text, p_command text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname = p_name loop
    perform cron.unschedule(v_jobid);
  end loop;
  perform cron.schedule(p_name, p_schedule, p_command);
end;
$$;

revoke execute on function
  public.community_settings_set(text, text),
  public.community_setting(text),
  public.community_project_url(),
  public.community_anon_key(),
  public.community_call_function(text, jsonb),
  public.community_schedule(text, text, text)
from public, anon, authenticated;
grant execute on function
  public.community_settings_set(text, text),
  public.community_setting(text),
  public.community_project_url(),
  public.community_anon_key(),
  public.community_call_function(text, jsonb),
  public.community_schedule(text, text, text)
to service_role;
