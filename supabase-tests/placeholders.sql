-- Placeholder profiles (core/019_placeholders.sql).
-- Run against a backend with core applied, after 019:
--   npx supabase db query --linked --project-ref <ref> --yes -f supabase-tests/placeholders.sql
-- It flips is_placeholder on one existing profile, adds content dated 2001, then always rolls back by
-- raising at the end: the run passed when the error message is exactly PLACEHOLDERS_TESTS_PASSED.
do $$
declare
  ids uuid[];
  m uuid; ph uuid;
  j jsonb;
  b jsonb;
  failed boolean;
begin
  select array_agg(id) into ids from (select id from public.profiles where not is_banned order by created_at limit 2) s;
  assert cardinality(ids) = 2, 'the backend needs two profiles';
  m := ids[1]; ph := ids[2];
  update public.profiles set is_house = false where id = any(ids);
  update public.profiles set is_placeholder = (id = ph) where id = any(ids);
  -- Both signed up in the window; every other profile after it.
  update public.profiles set created_at = '2001-03-01 08:00Z' where id = any(ids);
  update public.profiles set created_at = '2001-06-01Z' where id <> all(ids);

  insert into public.posts (author_id, content, status, created_at) values (m, 'member', 'visible', '2001-03-02 10:00Z');
  insert into public.posts (author_id, content, status, created_at) values (ph, 'placeholder', 'visible', '2001-03-02 11:00Z');
  insert into public.comments (post_id, author_id, content, status, created_at)
    select id, ph, 'c', 'visible', '2001-03-02 12:00Z' from public.posts where content = 'member';

  j := public.admin_daily_metrics('2001-03-01', '2001-03-03', 'UTC');
  assert (j->'daily'->1->>'posts')::int = 1, 'a placeholder post is not counted: ' || (j->'daily'->1)::text;
  assert (j->'daily'->1->>'comments')::int = 0, 'a placeholder comment is not counted';
  assert (j->>'contributors')::int = 1, 'a placeholder is not a contributor';
  assert (j->>'new_members')::int = 1, 'a placeholder is not a new member';
  assert (j->>'members_total')::int = 1, 'a placeholder is not in members_total';
  assert (j->>'active_members')::int = 1, 'a placeholder is not an active member';

  b := public.admin_activity_breakdown('2001-03-01', '2001-03-03', 'UTC');
  assert jsonb_array_length(b->'top_posts') = 1, 'a placeholder post is not a top post';

  -- is_placeholder is not client-writable.
  perform set_config('request.jwt.claims', json_build_object('sub', ph, 'role', 'authenticated')::text, true);
  set local role authenticated;
  failed := false;
  begin
    update public.profiles set is_placeholder = false where id = ph;
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  assert failed, 'authenticated must not update is_placeholder';

  raise exception 'PLACEHOLDERS_TESTS_PASSED';
end $$;
