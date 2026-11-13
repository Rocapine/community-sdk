-- Activity metrics (core/017_activity_metrics.sql).
-- Run against a backend with core applied, after 017 (polls and reaction optional):
--   supabase db query --linked --project-ref <ref> --yes -f supabase-tests/activity-metrics.sql
-- It flips is_house on four existing profiles and adds content dated 2001 (plus two posts of
-- today), then always rolls back by raising at the end: the run passed when the error message is
-- exactly ACTIVITY_METRICS_TESTS_PASSED.
do $$
declare
  ids uuid[];
  m1 uuid; m2 uuid; m3 uuid; h uuid;
  p1 uuid; p2 uuid; p3 uuid; hp uuid; c1 uuid; c3 uuid; opt uuid;
  has_polls boolean := to_regclass('public.poll_votes') is not null;
  has_reactions boolean := to_regclass('public.post_reactions') is not null;
  j jsonb;
  b jsonb;
  d jsonb;
  today date := (now() at time zone 'UTC')::date;
begin
  select array_agg(id) into ids from (select id from public.profiles order by created_at limit 4) s;
  assert cardinality(ids) = 4, 'the backend needs four profiles';
  m1 := ids[1]; m2 := ids[2]; m3 := ids[3]; h := ids[4];
  update public.profiles set is_house = (id = h) where id = any(ids);

  -- m1: 3 posts + comments in the window. m2: 1 (its first post and its comment are deleted).
  -- m3: only likes. h: a house account, in no count.
  insert into public.posts (author_id, content, status, created_at)
    values (m2, 'first, deleted', 'deleted', '2001-03-01 09:00Z');
  insert into public.posts (author_id, content, topic, status, moderated_at, created_at)
    values (m1, 'p1', 'tA', 'hidden', '2001-03-05 10:00Z', '2001-03-02 10:00Z') returning id into p1;
  insert into public.posts (author_id, content, status, created_at)
    values (m1, 'p2', 'visible', '2001-03-03 10:00Z') returning id into p2;
  insert into public.posts (author_id, content, topic, status, created_at)
    values (m2, 'p3', 'tA', 'visible', '2001-03-04 10:00Z') returning id into p3;
  insert into public.posts (author_id, content, topic, status, moderated_at, created_at)
    values (h, 'house', 'house', 'hidden', '2001-03-05 11:00Z', '2001-03-04 11:00Z') returning id into hp;

  -- p1: a self-reply and a deleted reply, so not replied and unanswered.
  insert into public.comments (post_id, author_id, content, status, created_at)
    values (p1, m1, 'self', 'visible', '2001-03-02 10:30Z') returning id into c1;
  insert into public.comments (post_id, author_id, content, status, created_at)
    values (p1, m2, 'gone', 'deleted', '2001-03-02 12:00Z');
  -- p2: the team replies within 24 h. p3: the team replies after 24 h (answered, not in time).
  insert into public.comments (post_id, author_id, content, status, created_at)
    values (p2, h, 'team', 'visible', '2001-03-03 20:00Z') returning id into c3;
  insert into public.comments (post_id, author_id, content, status, created_at)
    values (p3, h, 'late', 'visible', '2001-03-06 10:00Z');
  insert into public.comments (post_id, author_id, content, status, created_at)
    values (hp, h, 'house on house', 'visible', '2001-03-04 11:30Z');

  insert into public.likes (post_id, user_id, created_at) values
    (p1, m3, '2001-03-02 15:00Z'), (p1, h, '2001-03-02 15:30Z'),
    (p3, m1, '2001-03-04 12:00Z'), (hp, m1, '2001-03-04 12:30Z');
  insert into public.comment_likes (comment_id, user_id, created_at) values
    (c3, m3, '2001-03-03 21:00Z'), (c1, h, '2001-03-03 21:30Z');
  if has_polls then
    insert into public.poll_options (post_id, idx, label) values (p3, 0, 'a') returning id into opt;
    insert into public.poll_votes (post_id, option_id, user_id, created_at) values
      (p3, opt, m1, '2001-03-04 13:00Z'), (p3, opt, h, '2001-03-04 13:30Z');
  end if;
  if has_reactions then
    insert into public.post_reactions (post_id, user_id, created_at) values
      (p1, m2, '2001-03-02 16:00Z'), (p1, h, '2001-03-02 16:30Z');
  end if;

  -- Window 2001-03-01..08, two arguments (UTC).
  j := public.admin_daily_metrics('2001-03-01', '2001-03-08');
  assert (select array_agg(k order by k) from jsonb_object_keys(j) k)
    = array['contribution_buckets','contributors','daily','reactors','reply_rate','topics','tz','unanswered'],
    'top-level keys: ' || (select string_agg(k, ',') from jsonb_object_keys(j) k);
  assert j->>'tz' = 'UTC', 'two arguments mean UTC';
  assert jsonb_array_length(j->'daily') = 8, 'one row per day, both ends included';
  assert (select array_agg(k order by k) from jsonb_object_keys(j->'daily'->0) k)
    = array['comments','contributors','day','hidden','likes','new_posters','poll_votes','posts',
            'reactions','replied_24h','reply_eligible'],
    'daily keys: ' || (select string_agg(k, ',') from jsonb_object_keys(j->'daily'->0) k);

  d := j->'daily'->0;
  assert d->>'day' = '2001-03-01' and (d->>'posts')::int = 0 and (d->>'new_posters')::int = 0,
    'a deleted first post is neither a post nor a new poster: ' || d;
  d := j->'daily'->1;
  assert d->>'day' = '2001-03-02' and (d->>'posts')::int = 1 and (d->>'comments')::int = 1
    and (d->>'new_posters')::int = 1 and (d->>'likes')::int = 1 and (d->>'contributors')::int = 1
    and (d->>'replied_24h')::int = 0 and (d->>'reply_eligible')::int = 1,
    'a hidden post counts, a self-reply and a deleted reply do not answer it, the house like is out: ' || d;
  d := j->'daily'->2;
  assert (d->>'posts')::int = 1 and (d->>'comments')::int = 0 and (d->>'likes')::int = 1
    and (d->>'replied_24h')::int = 1 and (d->>'reply_eligible')::int = 1 and (d->>'new_posters')::int = 0,
    'a team reply within 24 h counts, the team comment and its like on a member comment do not: ' || d;
  d := j->'daily'->3;
  assert (d->>'posts')::int = 1 and (d->>'comments')::int = 0 and (d->>'likes')::int = 2
    and (d->>'new_posters')::int = 1 and (d->>'replied_24h')::int = 0 and (d->>'contributors')::int = 1,
    'house post and comments out, a member like on a house post in, m2 new on its second post: ' || d;
  d := j->'daily'->4;
  assert (d->>'hidden')::int = 1, 'members'' posts hidden that day, not the house post: ' || d;
  assert (select sum((e->>'hidden')::int) from jsonb_array_elements(j->'daily') e) = 1, 'one hidden post in all';
  assert (select sum((e->>'comments')::int) from jsonb_array_elements(j->'daily') e) = 1, 'house comments are out';
  assert (select sum((e->>'likes')::int) from jsonb_array_elements(j->'daily') e) = 4, 'four member likes';

  if has_polls then
    assert (j->'daily'->3->>'poll_votes')::int = 1
      and (select sum((e->>'poll_votes')::int) from jsonb_array_elements(j->'daily') e) = 1,
      'one member poll vote: ' || (j->'daily');
  else
    assert j->'daily'->3->'poll_votes' = 'null'::jsonb, 'no polls module, no poll votes';
  end if;
  if has_reactions then
    assert (j->'daily'->1->>'reactions')::int = 1
      and (select sum((e->>'reactions')::int) from jsonb_array_elements(j->'daily') e) = 1,
      'one member reaction: ' || (j->'daily');
  else
    assert j->'daily'->1->'reactions' = 'null'::jsonb, 'no reaction module, no reactions';
  end if;

  assert j->'topics' = '[{"topic": "tA", "count": 2}, {"topic": "(sans)", "count": 1}]'::jsonb,
    'members'' posts by topic, no house topic: ' || (j->'topics');
  assert abs((j->>'reply_rate')::numeric - 1.0 / 3) < 0.0001, 'one of three posts replied in 24 h: ' || (j->>'reply_rate');
  assert (j->>'unanswered')::int = 1, 'p1 has only a self-reply and a deleted reply: ' || (j->>'unanswered');
  assert (j->>'contributors')::int = 2, 'm1 and m2 wrote: ' || (j->>'contributors');
  assert (j->>'reactors')::int = 1, 'm3 only liked: ' || (j->>'reactors');
  assert j->'contribution_buckets' = '{"1": 1, "2-3": 1, "4-7": 0, "8+": 0}'::jsonb,
    'm2 wrote 1, m1 wrote 3: ' || (j->'contribution_buckets');

  -- A window with no content.
  j := public.admin_daily_metrics('2001-02-01', '2001-02-02');
  assert (j->>'reply_rate')::numeric = 0 and (j->>'unanswered')::int = 0 and j->'topics' = '[]'::jsonb,
    'nothing eligible gives a rate of 0: ' || j;

  -- Days are in the zone asked for: 23:30 UTC on 10 March is 00:30 on 11 March in Paris.
  insert into public.posts (author_id, content, status, created_at)
    values (m1, 'late night', 'visible', '2001-03-10 23:30Z');
  j := public.admin_daily_metrics('2001-03-10', '2001-03-11');
  assert (j->'daily'->0->>'posts')::int = 1 and (j->'daily'->1->>'posts')::int = 0, 'UTC: on the 10th: ' || (j->'daily');
  assert (j->'daily'->0->>'new_posters')::int = 0, 'm1 first posted on the 2nd';
  j := public.admin_daily_metrics('2001-03-10', '2001-03-11', 'Europe/Paris');
  assert j->>'tz' = 'Europe/Paris', 'the zone is echoed';
  assert (j->'daily'->0->>'posts')::int = 0 and (j->'daily'->1->>'posts')::int = 1, 'Paris: on the 11th: ' || (j->'daily');
  j := public.admin_daily_metrics('2001-03-10', '2001-03-10', 'Europe/Paris');
  assert (j->'daily'->0->>'posts')::int = 0 and (j->>'unanswered')::int = 0, 'Paris: not in the 10th at all: ' || j;

  -- Posts under 24 h old are out of the rate and out of unanswered; an older one is in both.
  b := public.admin_daily_metrics(today - 2, today);
  insert into public.posts (author_id, content, status, created_at)
    values (m1, 'young', 'visible', now() - interval '1 hour'), (m1, 'older', 'visible', now() - interval '30 hours');
  j := public.admin_daily_metrics(today - 2, today);
  assert (select sum((e->>'posts')::int) from jsonb_array_elements(j->'daily') e)
    = (select sum((e->>'posts')::int) from jsonb_array_elements(b->'daily') e) + 2, 'both posts count';
  assert (select sum((e->>'reply_eligible')::int) from jsonb_array_elements(j->'daily') e)
    = (select sum((e->>'reply_eligible')::int) from jsonb_array_elements(b->'daily') e) + 1, 'only the older post is eligible';
  assert (j->>'unanswered')::int = (b->>'unanswered')::int + 1, 'only the older post is unanswered';

  assert public.admin_daily_metrics('2001-03-11', '2001-03-10')->'daily' = '[]'::jsonb, 'an inverted range gives no days';

  begin
    perform public.admin_daily_metrics('2001-03-10', '2001-03-10', 'Invalid/Zone');
    assert false, 'an invalid zone is accepted';
  exception when sqlstate '22023' then assert sqlerrm = 'invalid_time_zone', sqlerrm;
  end;
  begin
    perform public.admin_daily_metrics('2001-03-10', '2001-03-10', 'EST5EDT,M3.2.0,M11.1.0');
    assert false, 'a POSIX zone is accepted';
  exception when sqlstate '22023' then assert sqlerrm = 'invalid_time_zone', sqlerrm;
  end;

  assert has_function_privilege('service_role', 'public.admin_daily_metrics(date,date,text)', 'execute'),
    'service_role can read the metrics';
  assert not has_function_privilege('authenticated', 'public.admin_daily_metrics(date,date,text)', 'execute')
    and not has_function_privilege('anon', 'public.admin_daily_metrics(date,date,text)', 'execute'),
    'clients cannot read the metrics';
  assert not exists (select 1 from pg_proc where proname = 'admin_daily_metrics' and pronargs = 2),
    'the two-argument version is gone';

  raise exception 'ACTIVITY_METRICS_TESTS_PASSED';
end $$;
