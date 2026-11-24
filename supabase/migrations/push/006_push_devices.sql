-- community-sdk push/006_push_devices.sql
-- One profile, several devices: a member signed in on a phone and a tablet gets the push on both.
-- Additive: builds in the field keep writing push_tokens (a single token + the notify_* prefs),
-- and the senders read the union of both tables. Idempotent.
create table if not exists public.push_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  expo_push_token text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table public.push_devices enable row level security;

drop policy if exists "read own push device" on public.push_devices;
create policy "read own push device" on public.push_devices for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "insert own push device" on public.push_devices;
create policy "insert own push device" on public.push_devices for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "update own push device" on public.push_devices;
create policy "update own push device" on public.push_devices for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own push device" on public.push_devices;
create policy "delete own push device" on public.push_devices for delete to authenticated
  using (user_id = auth.uid());
