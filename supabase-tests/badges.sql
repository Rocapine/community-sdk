-- Badges module + the streak expand migration (badges/001, streaks/002).
-- Run against a backend with both applied:
--   npx supabase db query --remote=<ref> --yes -f supabase-tests/badges.sql
-- It changes one profile, then always rolls back by raising at the end: the run
-- passed when the error message is exactly BADGES_TESTS_PASSED.
do $$
declare
  pid uuid;
  p record;
begin
  select id into pid from public.profiles limit 1;

  -- Generic badges: visible ones are readable, hidden ones never are.
  update public.profiles set badges = '{"rank":{"n":3},"zodiac":{"sign":"leo"}}', hidden_badges = '{}' where id = pid;
  select * into p from public.profiles where id = pid;
  assert p.visible_badges = '{"rank":{"n":3},"zodiac":{"sign":"leo"}}'::jsonb, 'visible_badges mirrors badges';
  update public.profiles set hidden_badges = '{rank}' where id = pid;
  select * into p from public.profiles where id = pid;
  assert p.visible_badges = '{"zodiac":{"sign":"leo"}}'::jsonb, 'a hidden badge leaves visible_badges';

  -- Size and shape guard.
  begin
    update public.profiles set badges = jsonb_build_object('big', repeat('x', 3000)) where id = pid;
    assert false, 'a 3 KB badges value is refused';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set badges = '[1,2]' where id = pid;
    assert false, 'a non-object badges value is refused';
  exception when check_violation then null;
  end;

  -- An old client writes the legacy streak columns: the badges follow.
  update public.profiles set badges = '{}', hidden_badges = '{}' where id = pid;
  update public.profiles
    set streak_started_at = '2026-10-01T00:00:00Z', best_streak_days = 41
    where id = pid;
  select * into p from public.profiles where id = pid;
  assert (p.badges->'streak'->>'since')::timestamptz = '2026-10-01T00:00:00Z', 'legacy start -> badges.streak.since';
  assert p.badges->'bestStreak'->>'days' = '41', 'legacy best -> badges.bestStreak.days';

  -- A new client writes the badges: the legacy columns follow, for old readers.
  update public.profiles set badges = '{"streak":{"since":"2026-10-05T00:00:00Z"}}' where id = pid;
  select * into p from public.profiles where id = pid;
  assert p.streak_started_at = '2026-10-05T00:00:00Z', 'badges.streak.since -> legacy start';
  assert p.best_streak_days is null, 'no bestStreak badge -> no legacy best';
  assert p.visible_streak_started_at = '2026-10-05T00:00:00Z', 'old readers see the new value';

  -- Visibility, both ways.
  update public.profiles set badges = '{"streak":{"since":"2026-10-05T00:00:00Z"},"bestStreak":{"days":12}}' where id = pid;
  update public.profiles set show_best_streak = false where id = pid;
  select * into p from public.profiles where id = pid;
  assert 'bestStreak' = any(p.hidden_badges), 'legacy toggle -> hidden_badges';
  assert not (p.visible_badges ? 'bestStreak'), 'legacy toggle hides the badge';
  update public.profiles set hidden_badges = '{}' where id = pid;
  select * into p from public.profiles where id = pid;
  assert p.show_best_streak, 'hidden_badges -> legacy toggle';
  assert p.visible_best_streak_days = 12, 'old readers see the best streak again';

  -- Other badges survive a legacy write.
  update public.profiles set badges = badges || '{"rank":{"n":1}}' where id = pid;
  update public.profiles set best_streak_days = 13 where id = pid;
  select * into p from public.profiles where id = pid;
  assert p.badges->'rank'->>'n' = '1', 'a legacy write keeps the other badges';
  assert p.badges->'bestStreak'->>'days' = '13', 'and updates its own';

  -- One write carrying both forms: the badges win, and so do hidden_badges.
  update public.profiles set
      badges = '{"streak":{"since":"2026-10-07T00:00:00Z"}}',
      streak_started_at = '2026-01-01T00:00:00Z', best_streak_days = 99,
      hidden_badges = '{streak}', show_streak = true, show_best_streak = false
    where id = pid;
  select * into p from public.profiles where id = pid;
  assert p.streak_started_at = '2026-10-07T00:00:00Z', 'badges win over legacy in one write';
  assert p.best_streak_days is null, 'and drive the legacy best too';
  assert not p.show_streak and p.show_best_streak, 'hidden_badges win over legacy toggles';

  -- An unreadable streak value does not fail the write; the legacy columns go empty.
  update public.profiles
    set badges = '{"streak":{"since":"not a date"},"bestStreak":{"days":1e40}}'
    where id = pid;
  select * into p from public.profiles where id = pid;
  assert p.badges->'streak'->>'since' = 'not a date', 'the badges are written as sent';
  assert p.streak_started_at is null and p.best_streak_days is null, 'unreadable values leave no legacy';

  raise exception 'BADGES_TESTS_PASSED';
end $$;
