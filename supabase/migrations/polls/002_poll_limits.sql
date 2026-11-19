-- community-sdk polls/002_poll_limits.sql (schema v1)
-- Poll limits become a per-project setting (default 2 to 4 options of up to 60
-- characters, the limits of polls/001). Set them from the SQL editor (service
-- role), with the same values as the app's `modules.polls` config:
--   select public.poll_set_limits(2, 7, 100);
-- Bounds: 2 <= min_options <= max_options <= 10, option_max_length 1..200.
-- The option limits move from CHECK constraints to a trigger that an importer can
-- switch off (alter table public.poll_options disable trigger user), like
-- core/018 did for post length. Fully idempotent.

create table if not exists public.poll_settings (
  id boolean primary key default true check (id),
  min_options int not null default 2,
  max_options int not null default 4,
  option_max_length int not null default 60,
  check (2 <= min_options and min_options <= max_options and max_options <= 10),
  check (option_max_length between 1 and 200)
);
insert into public.poll_settings (id) values (true) on conflict do nothing;
alter table public.poll_settings enable row level security;
revoke all on public.poll_settings from public, anon, authenticated;

-- The check constraints reject values outside the bounds above.
create or replace function public.poll_set_limits(p_min int, p_max int, p_max_length int)
returns void
language sql security definer set search_path = public
as $$
  insert into poll_settings (id, min_options, max_options, option_max_length)
    values (true, p_min, p_max, p_max_length)
  on conflict (id) do update set
    min_options = excluded.min_options,
    max_options = excluded.max_options,
    option_max_length = excluded.option_max_length;
$$;

revoke execute on function public.poll_set_limits(int, int, int) from public, anon, authenticated;
grant execute on function public.poll_set_limits(int, int, int) to service_role;

-- The effective limits (defaults when the row is missing). Readable by members:
-- create_poll_post and the option trigger run as the caller.
create or replace function public.poll_limits(
  out min_options int, out max_options int, out option_max_length int)
language sql stable security definer set search_path = public
as $$
  select coalesce(s.min_options, 2), coalesce(s.max_options, 4), coalesce(s.option_max_length, 60)
  from (select 1) one left join poll_settings s on true;
$$;

revoke execute on function public.poll_limits() from public, anon;
grant execute on function public.poll_limits() to authenticated, service_role;

create or replace function public.enforce_poll_option_limits()
returns trigger language plpgsql set search_path = '' as $$
declare
  lim record;
begin
  select * into lim from public.poll_limits();
  if new.idx >= lim.max_options then
    raise exception 'a poll has at most % options', lim.max_options using errcode = 'check_violation';
  end if;
  if char_length(new.label) > lim.option_max_length then
    raise exception 'a poll option is longer than % characters', lim.option_max_length
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists poll_options_limits on public.poll_options;
create trigger poll_options_limits
  before insert or update of idx, label on public.poll_options
  for each row execute function public.enforce_poll_option_limits();

-- The checks keep only the minimum.
alter table public.poll_options drop constraint if exists poll_options_idx_check;
alter table public.poll_options add constraint poll_options_idx_check check (idx >= 0);
alter table public.poll_options drop constraint if exists poll_options_label_check;
alter table public.poll_options add constraint poll_options_label_check check (char_length(label) >= 1);

-- Same as polls/001, with the option count read from the settings.
create or replace function public.create_poll_post(
  p_topic text,
  p_content text,
  p_options text[]
) returns uuid
language plpgsql set search_path = public
as $$
declare
  new_id uuid;
  n int := coalesce(array_length(p_options, 1), 0);
  lim record;
  i int;
begin
  select * into lim from public.poll_limits();
  if n < lim.min_options or n > lim.max_options then
    raise exception 'a poll needs % to % options', lim.min_options, lim.max_options;
  end if;
  insert into public.posts (author_id, topic, content)
    values (auth.uid(), p_topic, p_content)
    returning id into new_id;
  for i in 1..n loop
    insert into public.poll_options (post_id, idx, label)
      values (new_id, i - 1, p_options[i]);
  end loop;
  return new_id;
end;
$$;

revoke execute on function public.create_poll_post(text, text, text[]) from public, anon;
grant execute on function public.create_poll_post(text, text, text[]) to authenticated;
