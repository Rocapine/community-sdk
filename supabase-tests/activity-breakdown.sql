-- Activity breakdown (core/017_activity_metrics.sql, admin_activity_breakdown).
-- Run against a backend with core applied, after 017 (the push module adds profiles.locale):
--   supabase db query --linked --project-ref <ref> --yes -f supabase-tests/activity-breakdown.sql
-- It flips is_house on existing profiles and adds content dated April 2001, then always rolls back
-- by raising at the end: the run passed when the error message is exactly ACTIVITY_BREAKDOWN_TESTS_PASSED.
-- Window 2001-04-09 (Monday) .. 2001-04-15 in Europe/Paris (UTC+2); previous period 2001-04-02 .. 04-08.
do $$
declare
  ids uuid[];
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; h uuid;
  pa uuid; pb uuid; pc uuid; pd uuid; pe uuid; pf uuid; pdel uuid; hp uuid;
  j jsonb;
  e jsonb;
begin
  select array_agg(id) into ids from (select id from public.profiles order by created_at limit 5) s;
  assert cardinality(ids) = 5, 'the backend needs five profiles';
  m1 := ids[1]; m2 := ids[2]; m3 := ids[3]; m4 := ids[4]; h := ids[5];
  update public.profiles set is_house = (id = h), created_at = '2001-01-01Z' where id = any(ids);
  -- Every other profile signed up after the windows, so the test does not depend on the backend.
  update public.profiles set created_at = '2001-06-01Z' where id <> all(ids);
  update public.profiles set locale = case id when m1 then 'en' when m2 then 'fr' when m4 then 'de' when h then 'en' end
    where id = any(ids);
  update public.profiles set username = 'member-one' where id = m1;

  -- Current window. m1: pa (hidden by the AI), pd, pe, pf, cb, cc. m2: pb, ca. m3: pc, cd. House: hp and a comment.
  insert into public.posts (author_id, content, topic, status, moderated_at, created_at)
    values (m1, repeat('x', 200), 'tA', 'hidden', '2001-04-10 10:00Z', '2001-04-09 07:30Z') returning id into pa;
  insert into public.posts (author_id, content, topic, status, created_at)
    values (m2, 'pb', 'tB', 'visible', '2001-04-10 10:00Z') returning id into pb;
  insert into public.posts (author_id, content, status, created_at)
    values (m3, 'pc', 'visible', '2001-04-11 12:00Z') returning id into pc;
  insert into public.posts (author_id, content, status, created_at) values (m1, 'pd', 'visible', '2001-04-12 12:00Z') returning id into pd;
  insert into public.posts (author_id, content, status, created_at) values (m1, 'pe', 'visible', '2001-04-13 12:00Z') returning id into pe;
  insert into public.posts (author_id, content, status, created_at) values (m1, 'pf', 'visible', '2001-04-14 12:00Z') returning id into pf;
  -- Left out: a deleted post (Monday 09:30 Paris too, and liked twice), a house post with the most likes.
  insert into public.posts (author_id, content, status, created_at)
    values (m1, 'gone', 'deleted', '2001-04-09 07:30Z') returning id into pdel;
  insert into public.posts (author_id, content, status, moderated_at, created_at)
    values (h, 'house', 'hidden', '2001-04-10 11:00Z', '2001-04-09 07:30Z') returning id into hp;

  insert into public.comments (post_id, author_id, content, status, created_at)
    values (pa, m2, 'ca', 'visible', '2001-04-15 21:10Z');  -- Sunday 23:10 Paris
  insert into public.comments (post_id, author_id, content, status, moderated_at, created_at)
    values (pb, m1, 'cb', 'hidden', '2001-04-11 09:00Z', '2001-04-10 11:00Z');  -- hidden by the AI
  insert into public.comments (post_id, author_id, content, status, moderated_at, reviewed_at, created_at)
    values (pb, m1, 'cc', 'hidden', '2001-04-11 09:00Z', '2001-04-11 10:00Z', '2001-04-10 11:30Z');  -- hidden, reviewed by a human
  insert into public.comments (post_id, author_id, content, status, created_at)
    values (pc, m3, 'cd', 'visible', '2001-04-11 12:30Z');
  insert into public.comments (post_id, author_id, content, status, created_at) values
    (pa, m1, 'deleted', 'deleted', '2001-04-09 07:30Z'),
    (pa, h, 'house', 'visible', '2001-04-09 07:30Z');

  insert into public.likes (post_id, user_id, created_at) values
    (pa, m2, '2001-04-10 08:00Z'), (pa, m3, '2001-05-01 08:00Z'), (pa, h, '2001-04-10 08:00Z'),  -- a like counts at any time
    (pc, m1, '2001-04-12 08:00Z'), (pc, m2, '2001-04-12 08:00Z'),
    (hp, m1, '2001-04-10 08:00Z'), (hp, m2, '2001-04-10 08:00Z'), (hp, m3, '2001-04-10 08:00Z'), (hp, m4, '2001-04-10 08:00Z'),
    (pdel, m2, '2001-04-10 08:00Z'), (pdel, m3, '2001-04-10 08:00Z');

  -- Previous period. m1: pz (hidden by the AI). m2: pq. m4: pm. m3 only has a deleted post. House: a hidden post.
  insert into public.posts (author_id, content, status, moderated_at, created_at) values
    (m1, 'pz', 'hidden', '2001-04-05 10:00Z', '2001-04-04 10:00Z'),
    (m2, 'pq', 'visible', null, '2001-04-05 10:00Z'),
    (m4, 'pm', 'visible', null, '2001-04-06 10:00Z'),
    (m3, 'gone', 'deleted', null, '2001-04-03 10:00Z'),
    (h, 'house', 'hidden', '2001-04-05 11:00Z', '2001-04-05 11:00Z');

  insert into public.reports (reporter_id, reported_user_id, post_id, reason, created_at) values
    (m1, m2, pb, 'spam', '2001-04-10 12:00Z'), (m3, m1, pa, 'spam', '2001-04-12 12:00Z'),   -- current: 2
    (m1, m2, pb, 'spam', '2001-04-06 12:00Z'),                                              -- previous: 1
    (m1, m2, pb, 'spam', '2001-05-01 12:00Z');                                              -- outside both
  insert into public.moderation_actions (actor_email, action, target_post_id, created_at) values
    ('a@example.com', 'hide', pa, '2001-04-11 12:00Z'),                                     -- current: 1
    ('a@example.com', 'hide', pa, '2001-04-03 12:00Z'), ('a@example.com', 'restore', pa, '2001-04-07 12:00Z'),  -- previous: 2
    ('a@example.com', 'hide', pa, '2001-05-01 12:00Z');                                     -- outside both

  j := public.admin_activity_breakdown('2001-04-09', '2001-04-15', 'Europe/Paris');
  assert (select array_agg(k order by k) from jsonb_object_keys(j) k)
    = array['heatmap','languages','moderation','returning','top_posts','tz'],
    'top-level keys: ' || (select string_agg(k, ',') from jsonb_object_keys(j) k);
  assert j->>'tz' = 'Europe/Paris', 'tz is echoed';

  -- heatmap: Monday first, hours in tz, members only, deleted rows out.
  assert jsonb_array_length(j->'heatmap') = 7
    and (select bool_and(jsonb_array_length(r) = 24) from jsonb_array_elements(j->'heatmap') r), 'heatmap is 7 x 24';
  assert (j->'heatmap'->0->>9)::int = 1, 'Monday 09:30 Paris holds the post, not the deleted or house ones: ' || (j->'heatmap'->0)::text;
  assert (j->'heatmap'->6->>23)::int = 1, 'Sunday 23:10 Paris holds the comment: ' || (j->'heatmap'->6)::text;
  assert (select sum(v::int) from jsonb_array_elements(j->'heatmap') r, jsonb_array_elements_text(r) v) = 10,
    'ten member contributions in all';

  -- languages: posts + comments by the author's locale, count desc then locale, a null locale is one row.
  assert j->'languages' = '[{"locale":"en","count":6},{"locale":"fr","count":2},{"locale":null,"count":2}]'::jsonb,
    'languages: ' || (j->'languages')::text;

  -- moderation.
  assert j->'moderation' = '{"reports":2,"ai_hidden":2,"team_actions":1,"previous":{"reports":1,"ai_hidden":1,"team_actions":2}}'::jsonb,
    'moderation: ' || (j->'moderation')::text;

  -- returning: m1 and m2 posted in both periods, m4 only before, m3 only now.
  assert j->'returning' = '{"previous_contributors":3,"returned":2}'::jsonb, 'returning: ' || (j->'returning')::text;

  -- top_posts: likes + comments desc then newest first; the limit is five; house and deleted posts are out.
  assert jsonb_array_length(j->'top_posts') = 5, 'at most five top posts';
  assert (select jsonb_agg(t->>'id') from jsonb_array_elements(j->'top_posts') t)
    = to_jsonb(array[pc, pa, pb, pf, pe]::text[]), 'top posts order: ' || (j->'top_posts')::text;
  e := j->'top_posts'->1;
  assert (select array_agg(k order by k) from jsonb_object_keys(e) k)
    = array['author_id','author_name','comments','created_at','excerpt','id','likes','topic'], 'top post keys: ' || e::text;
  assert (e->>'likes')::int = 2 and (e->>'comments')::int = 1, 'house like and house or deleted comment are out: ' || e::text;
  assert length(e->>'excerpt') = 140 and e->>'topic' = 'tA' and e->>'author_name' = 'member-one'
    and (e->>'author_id')::uuid = m1, 'excerpt, topic, author: ' || e::text;
  assert (j->'top_posts'->0->>'likes')::int = 2 and (j->'top_posts'->0->>'comments')::int = 1, 'pc: ' || (j->'top_posts'->0)::text;
  assert (j->'top_posts'->2->>'likes')::int = 0 and (j->'top_posts'->2->>'comments')::int = 2, 'pb: ' || (j->'top_posts'->2)::text;

  -- An inverted range is empty, not an error.
  j := public.admin_activity_breakdown('2001-04-11', '2001-04-10', 'Europe/Paris');
  assert jsonb_array_length(j->'heatmap') = 7
    and (select sum(v::int) from jsonb_array_elements(j->'heatmap') r, jsonb_array_elements_text(r) v) = 0
    and j->'languages' = '[]'::jsonb and j->'top_posts' = '[]'::jsonb
    and j->'moderation' = '{"reports":0,"ai_hidden":0,"team_actions":0,"previous":{"reports":0,"ai_hidden":0,"team_actions":0}}'::jsonb
    and j->'returning' = '{"previous_contributors":0,"returned":0}'::jsonb, 'an inverted range is empty: ' || j::text;

  -- Two arguments mean UTC: 2001-04-09 07:30Z is Monday 07 there.
  j := public.admin_activity_breakdown('2001-04-09', '2001-04-15');
  assert j->>'tz' = 'UTC' and (j->'heatmap'->0->>7)::int = 1, 'UTC by default: ' || (j->'heatmap'->0)::text;

  begin
    perform public.admin_activity_breakdown('2001-04-09', '2001-04-15', 'Invalid/Zone');
    assert false, 'an invalid zone is accepted';
  exception when sqlstate '22023' then assert sqlerrm = 'invalid_time_zone', sqlerrm;
  end;
  begin
    perform public.admin_activity_breakdown('2001-04-09', '2001-04-15', 'EST5EDT,M3.2.0,M11.1.0');
    assert false, 'a POSIX zone is accepted';
  exception when sqlstate '22023' then assert sqlerrm = 'invalid_time_zone', sqlerrm;
  end;

  assert has_function_privilege('service_role', 'public.admin_activity_breakdown(date,date,text)', 'execute'),
    'service_role can read the breakdown';
  assert not has_function_privilege('authenticated', 'public.admin_activity_breakdown(date,date,text)', 'execute')
    and not has_function_privilege('anon', 'public.admin_activity_breakdown(date,date,text)', 'execute'),
    'clients cannot read the breakdown';

  raise exception 'ACTIVITY_BREAKDOWN_TESTS_PASSED';
end $$;
