-- Pinning (core/012_pin_posts.sql).
-- Run against a backend with it applied:
--   npx supabase db query --remote=<ref> --yes -f supabase-tests/pinning.sql
-- It changes one profile and one post, then always rolls back by raising at the
-- end: the run passed when the error message is exactly PINNING_TESTS_PASSED.
do $$
declare
  pid uuid;
  post uuid;
  pinned timestamptz;
begin
  select id into pid from public.profiles where not is_banned limit 1;
  select id into post from public.posts limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', pid, 'role', 'authenticated')::text, true);

  update public.profiles set is_admin = false where id = pid;
  set local role authenticated;
  begin
    perform public.set_post_pinned(post, true);
    assert false, 'a member cannot pin';
  exception when insufficient_privilege then null;
  end;
  reset role;

  update public.profiles set is_admin = true where id = pid;
  set local role authenticated;
  perform public.set_post_pinned(post, true);
  reset role;
  select pinned_at into pinned from public.posts where id = post;
  assert pinned is not null, 'an admin pins';

  set local role authenticated;
  perform public.set_post_pinned(post, false);
  reset role;
  select pinned_at into pinned from public.posts where id = post;
  assert pinned is null, 'an admin unpins';

  raise exception 'PINNING_TESTS_PASSED';
end $$;
