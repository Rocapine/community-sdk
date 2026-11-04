-- community-sdk streaks/002_to_badges.sql (schema v1)
-- Moves the streak onto the badges module (badges/001 must run first): the current
-- streak becomes the `streak` badge ({ since }), the best one `bestStreak`
-- ({ days }), their toggles `hidden_badges`.
-- Expand step: the legacy columns stay, and a trigger keeps both forms equal in both
-- directions, so app builds still writing and reading the legacy columns keep
-- working next to the new ones. streaks/003 drops them once those builds are gone.
-- Fully idempotent.

update public.profiles set
  badges = badges
    || case when streak_started_at is not null
         then jsonb_build_object('streak', jsonb_build_object('since', to_jsonb(streak_started_at)))
         else '{}'::jsonb end
    || case when best_streak_days is not null
         then jsonb_build_object('bestStreak', jsonb_build_object('days', best_streak_days))
         else '{}'::jsonb end,
  hidden_badges = array(
    select distinct h from unnest(
      hidden_badges
      || case when not show_streak then array['streak'] else '{}'::text[] end
      || case when not show_best_streak then array['bestStreak'] else '{}'::text[] end
    ) h
  )
where streak_started_at is not null
   or best_streak_days is not null
   or not show_streak
   or not show_best_streak;

create or replace function public.profiles_sync_legacy_streak()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  legacy_changed boolean :=
    (new.streak_started_at, new.best_streak_days) is distinct from (old.streak_started_at, old.best_streak_days);
  legacy_shown_changed boolean :=
    (new.show_streak, new.show_best_streak) is distinct from (old.show_streak, old.show_best_streak);
  badges_changed boolean := new.badges is distinct from old.badges;
  hidden_changed boolean := new.hidden_badges is distinct from old.hidden_badges;
begin
  -- An old build wrote the legacy values: rewrite the two streak badges.
  if legacy_changed and not badges_changed then
    new.badges := (new.badges - 'streak' - 'bestStreak')
      || case when new.streak_started_at is not null
           then jsonb_build_object('streak', jsonb_build_object('since', to_jsonb(new.streak_started_at)))
           else '{}'::jsonb end
      || case when new.best_streak_days is not null
           then jsonb_build_object('bestStreak', jsonb_build_object('days', new.best_streak_days))
           else '{}'::jsonb end;
  -- A new build wrote the badges: keep the legacy columns in step for old readers.
  elsif badges_changed and not legacy_changed then
    new.streak_started_at := case when jsonb_typeof(new.badges -> 'streak' -> 'since') = 'string'
      then (new.badges -> 'streak' ->> 'since')::timestamptz end;
    new.best_streak_days := case when jsonb_typeof(new.badges -> 'bestStreak' -> 'days') = 'number'
      then greatest((new.badges -> 'bestStreak' ->> 'days')::numeric, 0)::int end;
  end if;

  if legacy_shown_changed and not hidden_changed then
    new.hidden_badges := array(
        select h from unnest(new.hidden_badges) h where h not in ('streak', 'bestStreak')
      )
      || case when not new.show_streak then array['streak'] else '{}'::text[] end
      || case when not new.show_best_streak then array['bestStreak'] else '{}'::text[] end;
  elsif hidden_changed and not legacy_shown_changed then
    new.show_streak := not ('streak' = any (new.hidden_badges));
    new.show_best_streak := not ('bestStreak' = any (new.hidden_badges));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_legacy_streak on public.profiles;
create trigger profiles_sync_legacy_streak
  before update on public.profiles
  for each row execute function public.profiles_sync_legacy_streak();
