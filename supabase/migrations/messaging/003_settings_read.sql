-- community-sdk messaging/003_settings_read.sql
-- Clients can't read messaging_settings (revoked in 001). The app's dev-only
-- schema check compares its config to the backend through this function.
-- Idempotent.

create or replace function public.messaging_client_settings()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select settings from messaging_settings where id = 1;
$$;

revoke all on function public.messaging_client_settings() from public, anon;
grant execute on function public.messaging_client_settings() to authenticated;
