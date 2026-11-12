-- Mutual blocks (core/016_mutual_blocks.sql, inbox/004, reaction/004).
-- Run against a backend with them applied:
--   npx supabase db query --remote=<ref> --yes -f supabase-tests/blocks.sql
-- It inserts posts, comments and blocks between four existing profiles, then
-- always rolls back by raising at the end: the run passed when the error message
-- is exactly BLOCKS_TESTS_PASSED. The inbox and reaction checks run only when
-- those modules are installed.
do $$
declare
  ids uuid[];
  a uuid; b uuid; c uuid; d uuid;
  a_post uuid; b_post uuid; c_post uuid; d_post uuid;
  a_comment uuid;
  n int;
  r record;
begin
  select array_agg(id) into ids from (
    select id from public.profiles where not is_banned and not is_admin limit 4
  ) s;
  assert coalesce(array_length(ids, 1), 0) = 4, 'needs four member profiles';
  a := ids[1]; b := ids[2]; c := ids[3]; d := ids[4];
  update public.profiles set is_admin = true where id = d;
  delete from public.blocks where blocker_id = any (ids) or blocked_id = any (ids);

  insert into public.posts (author_id, content, status) values (a, 'a post', 'visible')
    returning id into a_post;
  insert into public.posts (author_id, content, status) values (b, 'b post', 'visible')
    returning id into b_post;
  insert into public.posts (author_id, content, status) values (c, 'c post', 'visible')
    returning id into c_post;
  insert into public.posts (author_id, content, status) values (d, 'admin post', 'visible')
    returning id into d_post;
  insert into public.comments (post_id, author_id, content, status)
    values (c_post, a, 'a comment', 'visible') returning id into a_comment;
  insert into public.likes (post_id, user_id) values (a_post, b);

  -- A blocks B.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.blocks (blocker_id, blocked_id) values (a, b);
  assert (select count(*) from public.posts where id = b_post) = 0, 'A no longer sees B''s post';
  assert (select count(*) from public.profiles where id = b) = 0, 'nor B''s profile';
  assert (select count(*) from public.likes where post_id = a_post and user_id = b) = 0,
    'nor B''s like on A''s post';
  select count(*) into n from public.list_blocked_members() m where m.id = b;
  assert n = 1, 'A lists B as blocked';
  assert (select count(*) from public.profiles where id = a) = 1, 'A still reads their own profile';
  begin
    insert into public.blocks (blocker_id, blocked_id) values (a, d);
    assert false, 'an admin cannot be blocked';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- B no longer sees A, and cannot write under A's content.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.posts where id = a_post) = 0, 'B no longer sees A''s post';
  assert (select count(*) from public.comments where id = a_comment) = 0, 'nor A''s comment';
  assert (select count(*) from public.profiles where id = a) = 0, 'nor A''s profile';
  assert a = any (public.blocked_member_ids()), 'A is hidden from B';
  assert (select count(*) from public.list_blocked_members()) = 0, 'B blocked nobody';
  assert (select count(*) from public.posts where id = c_post) = 1, 'B still sees C';
  begin
    insert into public.comments (post_id, author_id, content) values (a_post, b, 'hey');
    assert false, 'B cannot comment under A''s post';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.comments (post_id, author_id, content, parent_id)
      values (c_post, b, 'hey', a_comment);
    assert false, 'B cannot reply to A''s comment';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
  begin
    insert into public.likes (post_id, user_id) values (a_post, b);
    assert false, 'B cannot like A''s post';
  exception when insufficient_privilege or unique_violation then null;
  end;
  begin
    delete from public.blocks where blocker_id = a;
    get diagnostics n = row_count;
    assert n = 0, 'B cannot lift A''s block';
  end;
  -- B still comments on C's post, and sees the admin.
  insert into public.comments (post_id, author_id, content) values (c_post, b, 'hi c');
  assert (select count(*) from public.posts where id = d_post) = 1, 'B sees the admin';
  reset role;

  -- C, unrelated, sees both.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.posts where id in (a_post, b_post)) = 2, 'C sees A and B';
  assert (select count(*) from public.profiles where id in (a, b)) = 2, 'and their profiles';
  reset role;

  -- A block made toward an admin before core/016 hides nothing.
  insert into public.blocks (blocker_id, blocked_id) values (a, d);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.posts where id = d_post) = 1, 'A still sees the admin';
  assert (select count(*) from public.profiles where id = d) = 1, 'and the admin''s profile';
  reset role;

  -- The inbox and the reaction summary forget B, past items included.
  if to_regprocedure('public.list_notifications(integer)') is not null then
    insert into public.notifications (user_id, kind, actor_id, post_id) values (a, 'like', b, a_post);
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.list_notifications(200) x where x.actor_id = b;
    assert n = 0, 'A''s inbox hides B''s past like';
    reset role;
  end if;
  if to_regclass('public.post_reactions') is not null then
    insert into public.post_reactions (post_id, user_id) values (a_post, b);
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select * into r from public.post_reaction_summary(array[a_post, b_post]);
    assert r is null, 'A''s summary neither counts nor names B, nor summarizes B''s post';
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select * into r from public.post_reaction_summary(array[a_post]);
    assert r.reaction_count = 1, 'C still counts B''s reaction';
    reset role;
  end if;

  -- A unblocks B: everything comes back.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.blocks where blocker_id = a and blocked_id = b;
  assert (select count(*) from public.posts where id = b_post) = 1, 'A sees B again';
  assert (select count(*) from public.profiles where id = b) = 1, 'and B''s profile';
  if to_regprocedure('public.list_notifications(integer)') is not null then
    select count(*) into n from public.list_notifications(200) x where x.actor_id = b;
    assert n > 0, 'B''s past likes are back in A''s inbox';
  end if;
  reset role;

  raise exception 'BLOCKS_TESTS_PASSED';
end $$;
