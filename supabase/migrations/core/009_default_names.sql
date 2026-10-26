-- community-sdk core/009_default_names.sql
-- Default names: every profile gets "<label> <digits>" / "<prefix>-<digits>"
-- (assign_default_profile, called by the client once per launch). The host
-- app's name seeds the profile until the user edits it through update-profile;
-- from then on a client write of `username` is ignored (the user wins). See
-- docs/superpowers/specs/2026-10-26-default-names-design.md.

alter table public.profiles
  add column if not exists default_username text,
  add column if not exists default_handle text,
  add column if not exists username_set_by_user boolean not null default false,
  add column if not exists handle_set_by_user boolean not null default false;

-- generate_handle with the slug to use when `base` has no usable letters
-- (a Korean or emoji-only name): the app's handle prefix instead of "member".
create or replace function public.generate_handle(base text, fallback text)
returns text
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  slug text;
  candidate text;
  tries int := 0;
begin
  slug := left(regexp_replace(lower(unaccent(coalesce(base, ''))), '[^a-z0-9]', '', 'g'), 12);
  if slug = '' then
    slug := left(regexp_replace(lower(coalesce(fallback, '')), '[^a-z0-9]', '', 'g'), 12);
  end if;
  if slug = '' then
    slug := 'member';
  end if;
  loop
    if tries < 5 then
      candidate := slug || '-' || (floor(random() * 9000) + 1000)::int;
    else
      candidate := slug || '-' || (floor(random() * 900000) + 100000)::int;
    end if;
    exit when not exists (select 1 from public.profiles where handle = candidate);
    tries := tries + 1;
  end loop;
  return candidate;
end;
$$;

create or replace function public.generate_handle(base text)
returns text
language sql volatile security definer
set search_path = public, extensions
as $$ select public.generate_handle(base, 'member') $$;

-- The default handle when it is still free, else a fresh one on its prefix.
create or replace function public.default_handle_for(p_id uuid, p_default text)
returns text
language plpgsql volatile security definer
set search_path = public, extensions
as $$
begin
  if p_default is null then
    return null;
  end if;
  if not exists (select 1 from public.profiles where handle = p_default and id <> p_id) then
    return p_default;
  end if;
  return public.generate_handle('', regexp_replace(p_default, '-[0-9]+$', ''));
end;
$$;

-- One trigger owns username + handle consistency (replaces core/001's
-- assign_handle and core/007's profiles_username_changed, whose relative order
-- mattered). "Trusted" writes are update-profile (service role) and this
-- file's security definer functions (they set community.trusted).
create or replace function public.profiles_names()
returns trigger
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  trusted boolean := coalesce(auth.role(), '') = 'service_role'
    or coalesce(current_setting('community.trusted', true), '') = 'on';
  prefix text;
begin
  if tg_op = 'UPDATE' and new.username is distinct from old.username then
    if not trusted and old.username_set_by_user then
      -- Host sync after the user picked their own name: the user wins.
      new.username := old.username;
    elsif new.username is null
      or (new.username = old.username_rejected and not trusted) then
      -- Blanked (moderation sweep, old clients, account scrub) or a re-sync of
      -- a name the sweep already blanked: back to the default name.
      new.username := old.default_username;
      new.username_checked_at := now();
    elsif new.username is not distinct from new.default_username then
      new.username_checked_at := now();
    else
      -- A genuinely new name: re-check it on the next sweep.
      new.username_checked_at := null;
    end if;
  end if;

  if new.username is not null and new.handle is null then
    new.handle := public.generate_handle(new.username,
      regexp_replace(coalesce(new.default_handle, ''), '-[0-9]+$', ''));
  elsif tg_op = 'UPDATE'
    and not new.handle_set_by_user
    and not new.username_set_by_user
    and new.username is distinct from old.username
    and new.handle is not distinct from old.handle then
    -- The host's name changed (or the sweep blanked it) and the user never
    -- picked a handle: follow it.
    if new.username is not distinct from new.default_username then
      new.handle := coalesce(public.default_handle_for(new.id, new.default_handle), new.handle);
    else
      prefix := regexp_replace(coalesce(new.default_handle, ''), '-[0-9]+$', '');
      new.handle := public.generate_handle(new.username, prefix);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assign_handle on public.profiles;
drop trigger if exists profiles_username_changed_trg on public.profiles;
drop function if exists public.assign_handle();
drop function if exists public.profiles_username_changed();

create trigger profiles_names_trg
  before insert or update of username, handle on public.profiles
  for each row execute function public.profiles_names();

-- Called by the client once per launch; idempotent. `p_label` is the app's
-- default name in the user's language ("Frère"), `p_handle` its ASCII handle
-- prefix ("brother"). Fills username / handle only when still null.
create or replace function public.assign_default_profile(p_label text, p_handle text)
returns void
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  label text := left(btrim(coalesce(p_label, '')), 17);
  h text;
  name text;
begin
  if uid is null then
    return;
  end if;
  if exists (select 1 from public.profiles where id = uid and default_username is not null) then
    return;
  end if;
  if label = '' then
    label := 'User';
  end if;
  h := public.generate_handle('', coalesce(nullif(p_handle, ''), 'user'));
  name := label || ' ' || substring(h from '-([0-9]+)$');
  perform set_config('community.trusted', 'on', true);
  update public.profiles
     set default_username = name,
         default_handle = h,
         username = coalesce(username, name),
         handle = coalesce(handle, h)
   where id = uid;
  perform set_config('community.trusted', '', true);
end;
$$;

-- Account deletion: default name and handle back, bio / avatar / edits cleared.
create or replace function public.reset_profile_identity()
returns void
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;
  perform set_config('community.trusted', 'on', true);
  update public.profiles
     set username = default_username,
         handle = coalesce(public.default_handle_for(id, default_handle), handle),
         username_set_by_user = false,
         handle_set_by_user = false,
         bio = null,
         avatar_url = null
   where id = uid;
  perform set_config('community.trusted', '', true);
end;
$$;

revoke execute on function public.generate_handle(text, text) from public, anon, authenticated;
revoke execute on function public.generate_handle(text) from public, anon, authenticated;
revoke execute on function public.default_handle_for(uuid, text) from public, anon, authenticated;
revoke execute on function public.profiles_names() from public, anon, authenticated;
revoke execute on function public.assign_default_profile(text, text) from public, anon;
revoke execute on function public.reset_profile_identity() from public, anon;
grant execute on function public.assign_default_profile(text, text) to authenticated;
grant execute on function public.reset_profile_identity() to authenticated;
