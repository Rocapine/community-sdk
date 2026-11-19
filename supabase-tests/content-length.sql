-- Content length (core/018_content_length.sql, images/003_content_length.sql).
-- Run against a backend with core and images applied:
--   npx supabase db query --linked --project-ref <ref> --yes -f supabase-tests/content-length.sql
-- It inserts a few posts and comments, then always rolls back by raising at the end: the run
-- passed when the error message is exactly CONTENT_LENGTH_TESTS_PASSED.
do $$
declare
  pid uuid;
  post uuid;
  big uuid;
  txt text;
begin
  select id into pid from public.profiles where not is_banned limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', pid, 'role', 'authenticated')::text, true);

  -- New writing stays limited: 2000 posts, 1000 comments.
  set local role authenticated;
  insert into public.posts (author_id, content) values (pid, repeat('a', 2000)) returning id into post;
  begin
    insert into public.posts (author_id, content) values (pid, repeat('a', 2001));
    assert false, 'a 2001-char post is refused';
  exception when check_violation then null;
  end;
  insert into public.comments (post_id, author_id, content) values (post, pid, repeat('a', 1000));
  begin
    insert into public.comments (post_id, author_id, content) values (post, pid, repeat('a', 1001));
    assert false, 'a 1001-char comment is refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.posts (author_id, content) values (pid, '');
    assert false, 'an empty post without an image is refused';
  exception when check_violation then null;
  end;
  reset role;

  -- An importer switches the triggers off and writes history of any length.
  alter table public.posts disable trigger user;
  alter table public.comments disable trigger user;
  insert into public.posts (author_id, content, status) values (pid, repeat('b', 5000), 'visible') returning id into big;
  insert into public.comments (post_id, author_id, content, status) values (big, pid, repeat('b', 3000), 'visible');
  alter table public.posts enable trigger user;
  alter table public.comments enable trigger user;

  -- Triggers back on: a long imported post is still moderable (the trigger only watches content).
  update public.posts set status = 'hidden' where id = big;
  select status into txt from public.posts where id = big;
  assert txt = 'hidden', 'a long post can be hidden';
  update public.comments set status = 'hidden' where post_id = big;

  raise exception 'CONTENT_LENGTH_TESTS_PASSED';
end $$;
