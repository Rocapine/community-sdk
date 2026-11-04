-- Admin accounts (core/011_admins.sql).
-- Run against a backend with it applied:
--   npx supabase db query --remote=<ref> --yes -f supabase-tests/admins.sql
-- It changes one profile and inserts one post, then always rolls back by raising
-- at the end: the run passed when the error message is exactly ADMINS_TESTS_PASSED.
do $$
declare
  pid uuid;
  p record;
begin
  select id into pid from public.profiles where not is_banned limit 1;

  update public.profiles set is_admin = true where id = pid;
  select * into p from public.profiles where id = pid;
  assert p.is_official, 'old readers still see an admin as official';
  update public.profiles set is_admin = false where id = pid;
  select * into p from public.profiles where id = pid;
  assert not p.is_official, 'and a member as not official';

  begin
    update public.profiles set is_official = true where id = pid;
    assert false, 'is_official is read-only';
  exception when generated_always then null;
  end;

  -- A member may now post in a topic once reserved for admins.
  perform set_config('request.jwt.claims', json_build_object('sub', pid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert not public.current_user_admin(), 'a member is not an admin';
  insert into public.posts (author_id, topic, content) values (pid, 'news', 'hello');
  reset role;

  raise exception 'ADMINS_TESTS_PASSED';
end $$;
