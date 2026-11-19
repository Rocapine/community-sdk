-- Poll limits (polls/002_poll_limits.sql, core/020_draft_poll_limits.sql).
-- Run against a backend with core and polls applied:
--   npx supabase db query --linked --project-ref <ref> --yes -f supabase-tests/polls-limits.sql
-- It changes the limits, one profile and publishes a few polls, then always rolls back by raising
-- at the end: the run passed when the error message is exactly POLL_LIMITS_TESTS_PASSED.
do $$
declare
  pid uuid;
  post uuid;
  d uuid;
  n int;
  lim record;
  seven text[] := array(select repeat(chr(96 + i), 100) from generate_series(1, 7) i);
begin
  select id into pid from public.profiles where not is_banned limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', pid, 'role', 'authenticated')::text, true);
  perform public.poll_set_limits(2, 4, 60); -- start from the defaults whatever the project set

  -- Defaults: 2 to 4 options of up to 60 characters.
  set local role authenticated;
  post := public.create_poll_post('general', 'q', array['a', repeat('b', 60), 'c', 'd']);
  begin
    perform public.create_poll_post('general', 'q', array['a', 'b', 'c', 'd', 'e']);
    assert false, 'a 5th option is refused';
  exception when raise_exception then null;
  end;
  begin
    perform public.create_poll_post('general', 'q', array['a']);
    assert false, 'a single option is refused';
  exception when raise_exception then null;
  end;
  begin
    perform public.create_poll_post('general', 'q', array['a', repeat('b', 61)]);
    assert false, 'a 61-char option is refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.poll_options (post_id, idx, label) values (post, 4, 'e');
    assert false, 'a 5th option row is refused';
  exception when check_violation then null;
  end;

  -- Members read the limits, never change them.
  select * into lim from public.poll_limits();
  assert lim.min_options = 2 and lim.max_options = 4 and lim.option_max_length = 60, 'defaults readable';
  begin
    perform public.poll_set_limits(2, 7, 100);
    assert false, 'a member cannot change the limits';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.poll_settings;
    assert false, 'a member cannot read the settings table';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Out-of-bounds settings are refused.
  begin perform public.poll_set_limits(2, 11, 60); assert false, 'max > 10 refused';
  exception when check_violation then null; end;
  begin perform public.poll_set_limits(3, 2, 60); assert false, 'min > max refused';
  exception when check_violation then null; end;
  begin perform public.poll_set_limits(1, 4, 60); assert false, 'min < 2 refused';
  exception when check_violation then null; end;
  begin perform public.poll_set_limits(2, 4, 201); assert false, 'length > 200 refused';
  exception when check_violation then null; end;

  -- 2 to 7 options of up to 100 characters.
  perform public.poll_set_limits(2, 7, 100);
  set local role authenticated;
  post := public.create_poll_post('general', 'q', seven);
  select count(*) into n from public.poll_options where post_id = post;
  assert n = 7, '7 options of 100 chars accepted';
  begin
    perform public.create_poll_post('general', 'q', seven || 'h'::text);
    assert false, 'an 8th option is refused';
  exception when raise_exception then null;
  end;
  begin
    perform public.create_poll_post('general', 'q', array['a', repeat('b', 101)]);
    assert false, 'a 101-char option is refused';
  exception when check_violation then null;
  end;
  reset role;

  -- Dashboard drafts follow the same limits.
  update public.profiles set is_house = true, is_admin = true where id = pid;
  insert into public.post_drafts (author_id, topic, content, poll_options, created_by, updated_by)
    values (pid, 'general', 'q', seven, 't@x', 't@x') returning id into d;
  post := public.publish_post_draft(d, 1, 't@x');
  select count(*) into n from public.poll_options where post_id = post;
  assert n = 7, 'a 7-option draft publishes';
  insert into public.post_drafts (author_id, topic, content, poll_options, created_by, updated_by)
    values (pid, 'general', 'q', seven || 'h'::text, 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 't@x');
    assert false, 'an 8-option draft is refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_poll', 'invalid_poll, got ' || sqlerrm;
  end;

  -- An importer switches the trigger off and writes options beyond the limits.
  perform public.poll_set_limits(2, 4, 60);
  insert into public.posts (author_id, content, status) values (pid, 'imported', 'visible') returning id into post;
  alter table public.poll_options disable trigger user;
  insert into public.poll_options (post_id, idx, label)
    select post, i - 1, repeat('x', 150) from generate_series(1, 9) i;
  alter table public.poll_options enable trigger user;
  select count(*) into n from public.poll_options where post_id = post;
  assert n = 9, 'imported options kept';

  raise exception 'POLL_LIMITS_TESTS_PASSED';
end $$;
