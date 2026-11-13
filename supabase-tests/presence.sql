-- Online presence (presence/001_presence.sql).
-- Run against a backend with it applied:
--   npx supabase db query --remote=<ref> --yes -f supabase-tests/presence.sql
-- It clears member_presence, stamps six existing profiles and always rolls back by
-- raising at the end: the run passed when the error message is exactly
-- PRESENCE_TESTS_PASSED.
do $$
declare
  ids uuid[];
  v uuid; a uuid; b uuid; c uuid; e uuid; s uuid;
begin
  select array_agg(id) into ids from (
    select id from public.profiles where not is_banned and not is_admin limit 6
  ) x;
  assert coalesce(array_length(ids, 1), 0) = 6, 'needs six member profiles';
  v := ids[1]; a := ids[2]; b := ids[3]; c := ids[4]; e := ids[5]; s := ids[6];
  delete from public.member_presence;
  delete from public.blocks where blocker_id = any (ids) or blocked_id = any (ids);
  insert into public.member_presence (user_id, last_active_at, visible) values
    (v, now(), true), (a, now(), true), (b, now(), false), (c, now(), true),
    (e, now(), true), (s, now() - interval '6 minutes', true);
  update public.profiles set is_banned = true where id = c;
  insert into public.blocks (blocker_id, blocked_id) values (v, e);

  assert (select grace_minutes from public.presence_settings) = 5, 'the seeded grace is 5 minutes';

  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.online_member_count() = 4, 'v, a, b, e count (c banned, s stale at 6 min)';
  assert public.online_member_ids(array[v,a,b,c,e,s]) @> array[v,a]
    and cardinality(public.online_member_ids(array[v,a,b,c,e,s])) = 2,
    'b hidden, c banned, e blocked, s stale';
  begin
    perform last_active_at from public.member_presence limit 1;
    raise exception 'timestamps readable';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.member_presence where user_id = a) = 0, 'others'' rows are invisible';
  begin
    perform public.presence_set_grace_minutes(60);
    raise exception 'a member set the grace';
  exception when insufficient_privilege then null;
  end;
  begin
    perform grace_minutes from public.presence_settings;
    raise exception 'presence_settings readable';
  exception when insufficient_privilege then null;
  end;
  perform public.set_presence_visible(false);
  assert (select visible from public.member_presence where user_id = v) = false, 'v hid themselves';
  assert public.online_member_ids(array[v]) = '{}', 'hidden v is not listed';
  perform public.set_presence_visible(true);
  reset role;

  -- The project owner widens the grace: s (6 min) is back in both readers.
  perform public.presence_set_grace_minutes(10);
  set local role authenticated;
  assert public.online_member_count() = 5, 's counts inside a 10-minute grace';
  assert s = any (public.online_member_ids(array[s])), 's is listed inside a 10-minute grace';
  reset role;
  delete from public.presence_settings;
  assert public.online_member_count() = 4, 'a missing settings row falls back to 5 minutes';
  perform public.presence_set_grace_minutes(5);
  begin
    perform public.presence_set_grace_minutes(0);
    raise exception 'grace 0 accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.presence_set_grace_minutes(61);
    raise exception 'grace 61 accepted';
  exception when check_violation then null;
  end;

  -- e, blocked by v, does not see v.
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- v is visible again, so only the block can exclude v; a is the positive control.
  assert a = any (public.online_member_ids(array[v,a,e])), 'a is in e''s list';
  assert not (v = any (public.online_member_ids(array[v,a,e]))), 'v is not in e''s list';
  reset role;

  -- anon cannot call anything.
  set local role anon;
  begin
    perform public.online_member_count();
    raise exception 'anon counted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.online_member_ids(array[a]);
    raise exception 'anon listed ids';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.touch_presence();
    raise exception 'anon touched presence';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise exception 'PRESENCE_TESTS_PASSED';
end $$;
