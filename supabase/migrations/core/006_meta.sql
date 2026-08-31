-- community-sdk core/006_meta.sql (schema v1)
-- Community SDK — 06 schema metadata: lets the CLI / dashboard detect which
-- schema version an installed community backend is running.
create table if not exists public.community_meta (
  id boolean primary key default true check (id),
  schema_version int not null
);
insert into public.community_meta (schema_version) values (1)
  on conflict (id) do update set schema_version = excluded.schema_version;
alter table public.community_meta enable row level security;
create policy "community_meta readable" on public.community_meta for select using (true);
