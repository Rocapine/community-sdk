-- Placeholder, merged and deleted-account profiles in Activity (core/019_placeholders.sql,
-- core/021_imported_history.sql).
-- Run against a backend with core applied, after 021:
--   npx supabase db query --linked --project-ref <ref> --yes -f supabase-tests/placeholders.sql
-- It flips is_placeholder, merged_into and account_deleted_at on five existing profiles, adds content
-- dated 2001, then always rolls back by raising at the end: the run passed when the error message is
-- exactly PLACEHOLDERS_TESTS_PASSED.
do $$
declare
  ids uuid[];
  m uuid; ph uuid; pl uuid; dl uuid; mg uuid;
  mp uuid;
  j jsonb;
  b jsonb;
  failed boolean;
begin
  -- Five profiles with no content of their own, so real data can't move a join date or a count.
  -- poll_votes is an optional module: checked only where installed.
  execute format($q$select array_agg(id) from (select p.id from public.profiles p where not p.is_banned
      and not exists (select 1 from public.posts where author_id = p.id)
      and not exists (select 1 from public.comments where author_id = p.id)
      and not exists (select 1 from public.likes where user_id = p.id)
      and not exists (select 1 from public.comment_likes where user_id = p.id) %s
      order by p.created_at limit 5) s$q$,
    case when to_regclass('public.poll_votes') is not null
      then 'and not exists (select 1 from public.poll_votes where user_id = p.id)' else '' end) into ids;
  assert cardinality(ids) = 5, 'the backend needs five unbanned profiles with no posts, comments, likes or votes';
  m := ids[1]; ph := ids[2]; pl := ids[3]; dl := ids[4]; mg := ids[5];
  -- m: a member. ph: a placeholder with a post and a comment. pl: a placeholder with only a like.
  -- dl: a member who deletes their account inside the window. mg: a profile merged into dl.
  update public.profiles set is_house = false, is_placeholder = id in (ph, pl),
    merged_into = case when id = mg then dl end,
    account_deleted_at = case when id = dl then '2001-03-03 12:00Z'::timestamptz end,
    -- ph was created 30 days after its first post (an import); it joins on that post.
    created_at = case when id = ph then '2001-04-01 11:00Z'::timestamptz else '2001-03-01 08:00Z' end
    where id = any(ids);
  update public.profiles set created_at = '2001-06-01Z' where id <> all(ids);

  insert into public.posts (author_id, content, status, created_at) values (m, 'member', 'visible', '2001-03-02 10:00Z')
    returning id into mp;
  insert into public.posts (author_id, content, status, created_at) values (ph, 'placeholder', 'visible', '2001-03-02 11:00Z');
  insert into public.comments (post_id, author_id, content, status, created_at) values (mp, ph, 'c', 'visible', '2001-03-02 12:00Z');
  insert into public.posts (author_id, content, status, created_at) values (dl, 'deleted', 'visible', '2001-03-03 10:00Z');
  insert into public.likes (post_id, user_id, created_at) values (mp, pl, '2001-03-03 09:00Z');
  -- A merge moves content to the target; rows left on mg (not possible in practice) still don't count.
  insert into public.comments (post_id, author_id, content, status, created_at) values (mp, mg, 'merged', 'visible', '2001-03-03 11:00Z');
  insert into public.likes (post_id, user_id, created_at) values (mp, mg, '2001-03-03 11:00Z');

  j := public.admin_daily_metrics('2001-03-01', '2001-03-03', 'UTC');
  -- A placeholder's post and comment count.
  assert (j->'daily'->1->>'posts')::int = 2, 'a placeholder post is counted: ' || (j->'daily'->1)::text;
  assert (j->'daily'->1->>'comments')::int = 1, 'a placeholder comment is counted: ' || (j->'daily'->1)::text;
  assert (j->'daily'->1->>'contributors')::int = 2, 'a placeholder is a contributor: ' || (j->'daily'->1)::text;
  -- ph joins on its first post (the 2nd), not on its created_at; pl, with no post or comment, on its created_at.
  assert (select array_agg((e->>'new_members')::int order by e->>'day') from jsonb_array_elements(j->'daily') e)
    = array[3, 1, 0], 'new members per day (m, pl, dl; ph; none): ' || (j->'daily')::text;
  assert (j->>'new_members')::int = 4, 'new members: m, ph, pl, dl, never the merged mg: ' || (j->>'new_members');
  -- pl's like counts; mg's like and comment don't.
  assert (j->'daily'->2->>'likes')::int = 1, 'only the placeholder like counts on the 3rd: ' || (j->'daily'->2)::text;
  assert (j->'daily'->2->>'comments')::int = 0, 'a merged profile comment does not count: ' || (j->'daily'->2)::text;
  -- dl's post counts although dl deleted their account.
  assert (j->'daily'->2->>'posts')::int = 1, 'a deleted account post counts: ' || (j->'daily'->2)::text;
  assert (j->'daily'->2->>'active_members')::int = 2, 'active on the 3rd: dl and pl, not mg: ' || (j->'daily'->2)::text;
  assert (j->>'contributors')::int = 3, 'contributors: m, ph, dl: ' || (j->>'contributors');
  assert (j->>'active_members')::int = 4, 'active members: m, ph, pl, dl: ' || (j->>'active_members');
  assert (j->>'reactors')::int = 1, 'reactors: pl only: ' || (j->>'reactors');
  -- members_total: dl was deleted on the 3rd, so it counts in windows ending before, not in this one.
  assert (j->>'members_total')::int = 3, 'members_total: m, ph, pl: ' || (j->>'members_total');
  assert (public.admin_daily_metrics('2001-03-01', '2001-03-02')->>'members_total')::int = 4,
    'members_total before the deletion: m, ph, pl, dl';
  assert (public.admin_daily_metrics('2001-03-01', '2001-03-01')->>'members_total')::int = 3,
    'members_total on the 1st: m, pl, dl (ph joins on the 2nd)';

  b := public.admin_activity_breakdown('2001-03-01', '2001-03-03', 'UTC');
  assert jsonb_array_length(b->'top_posts') = 3, 'top posts: m, ph and dl: ' || (b->'top_posts')::text;
  assert (select (e->>'likes')::int = 1 and (e->>'comments')::int = 1 from jsonb_array_elements(b->'top_posts') e
    where (e->>'id')::uuid = mp), 'the member post: pl''s like and ph''s comment, not mg''s: ' || (b->'top_posts')::text;

  -- is_placeholder, merged_into and account_deleted_at are not client-writable.
  perform set_config('request.jwt.claims', json_build_object('sub', ph, 'role', 'authenticated')::text, true);
  set local role authenticated;
  failed := false;
  begin
    update public.profiles set is_placeholder = false where id = ph;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'authenticated must not update is_placeholder';
  failed := false;
  begin
    update public.profiles set merged_into = null where id = ph;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'authenticated must not update merged_into';
  failed := false;
  begin
    update public.profiles set account_deleted_at = null where id = ph;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'authenticated must not update account_deleted_at';
  reset role;

  raise exception 'PLACEHOLDERS_TESTS_PASSED';
end $$;
