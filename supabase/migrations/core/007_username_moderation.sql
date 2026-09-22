-- Username moderation (daily sweep).
--
-- `profiles.username` is client-writable by design: the host app syncs its
-- own onboarding display name straight into it, so it never went through
-- update-profile's synchronous moderation (handle / bio / avatar do). Revoking
-- the grant would break the pre-SDK app versions still installed, which write
-- the column directly, so moderation happens asynchronously instead: the
-- daily-moderation sweep checks every username it has not checked yet
-- (`username_checked_at is null`) and blanks the ones the moderation API
-- flags — the app then shows its anonymous fallback name. `username_rejected`
-- remembers the last blanked value so a client that re-syncs the same name
-- (every launch, in both source apps) is silently kept blank instead of
-- getting re-flagged every night.
--
-- Neither column is in the client-facing SELECT / UPDATE grants (core/002
-- scopes both to an explicit column list), so clients can't read or tamper
-- with the moderation state.
alter table public.profiles
  add column if not exists username_checked_at timestamptz,
  add column if not exists username_rejected text;

create or replace function public.profiles_username_changed()
returns trigger language plpgsql as $$
begin
  if new.username is distinct from old.username then
    if new.username is not null and new.username = old.username_rejected then
      -- Re-sync of a name the sweep already blanked: keep it blank.
      new.username := null;
    else
      -- A genuinely new name: re-check it on the next sweep.
      new.username_checked_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_username_changed_trg on public.profiles;
create trigger profiles_username_changed_trg
  before update of username on public.profiles
  for each row execute function public.profiles_username_changed();

-- Existing usernames are checked by the first sweeps after this migration
-- (batches of up to 1000 per run, see daily-moderation).
