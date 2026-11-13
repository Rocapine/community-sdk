-- community-sdk core/017_activity_metrics.sql (schema v1)
-- admin_daily_metrics, fixed for the dashboard's Activity section (service role only):
-- days in the team's zone (tz, an IANA name; two arguments mean UTC), house accounts out of
-- every count, posts and comments of any status but deleted, the reply rate per day (a reply is
-- a comment not deleted by someone other than the author within 24 h; posts under 24 h old are
-- left out), new posters on their first post that isn't deleted, and likes, poll votes,
-- reactions, unanswered posts, contributors and reactors. Poll votes and reactions are null
-- when the polls / reaction module is not installed. Also: new members (profiles created in the
-- window, per day and in all), active members (distinct members with any post, comment, like,
-- comment like, poll vote or reaction, per day and over the period), members_total (profiles
-- created before the window's end) and median_first_reply_minutes (median minutes to the first
-- non-deleted reply by someone else, over posts at least 24 h old; null when none was replied).
-- created_at indexes keep the window scans cheap. Replaces the two-argument version of core/004.
-- Also admin_activity_breakdown(from_date, to_date, tz): the Activity page's breakdowns in one
-- call (service role only): a 7 x 24 heatmap (Monday first, hours in tz) of member posts and
-- comments, those by author language (profiles.locale, from the push module; null when the
-- column is absent: then languages is null), moderation counts (reports by members, items the AI hid whatever their status or review now,
-- team moderation actions) against the previous period of the same length, how many of the previous period's
-- contributors came back, and the five top posts (whole content, image, verse, poll with votes). Same zone check and window as above.
-- Requires core/004. Fully idempotent.

create index if not exists posts_created_at_idx on public.posts (created_at);
create index if not exists comments_created_at_idx on public.comments (created_at);
create index if not exists likes_created_at_idx on public.likes (created_at);
create index if not exists comment_likes_created_at_idx on public.comment_likes (created_at);
create index if not exists profiles_created_at_idx on public.profiles (created_at);
create index if not exists reports_created_at_idx on public.reports (created_at);
do $$
begin
  if to_regclass('public.poll_votes') is not null then
    create index if not exists poll_votes_created_at_idx on public.poll_votes (created_at);
  end if;
  if to_regclass('public.post_reactions') is not null then
    create index if not exists post_reactions_created_at_idx on public.post_reactions (created_at);
  end if;
end $$;

drop function if exists public.admin_daily_metrics(date, date);

create or replace function public.admin_daily_metrics(from_date date, to_date date, tz text default 'UTC')
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  t0 timestamptz;
  t1 timestamptz;
  -- Member rows of an optional module in the window: per-day counts and the distinct [user, day] pairs.
  extra text := $q$
    with r as (
      select x.user_id, (x.created_at at time zone $3)::date as day
      from %I x join profiles a on a.id = x.user_id and not a.is_house
      where x.created_at >= $1 and x.created_at < $2)
    select coalesce((select jsonb_object_agg(day, n) from (select day, count(*) as n from r group by day) s), '{}'),
           coalesce((select jsonb_agg(distinct jsonb_build_array(user_id, day)) from r), '[]')$q$;
  vote_days jsonb;
  vote_pairs jsonb := '[]';
  reaction_days jsonb;
  reaction_pairs jsonb := '[]';
  result jsonb;
begin
  if tz is null or tz not in (select name from pg_timezone_names) then
    raise exception 'invalid_time_zone' using errcode = '22023';
  end if;
  t0 := from_date::timestamp at time zone tz;
  t1 := (to_date + 1)::timestamp at time zone tz;

  if to_regclass('public.poll_votes') is not null then
    execute format(extra, 'poll_votes') into vote_days, vote_pairs using t0, t1, tz;
  end if;
  if to_regclass('public.post_reactions') is not null then
    execute format(extra, 'post_reactions') into reaction_days, reaction_pairs using t0, t1, tz;
  end if;

  with
  days as (select generate_series(from_date, to_date, interval '1 day')::date as day),
  -- first_reply_min: minutes to the first non-deleted comment by someone other than the author.
  m_posts as (
    select author_id, topic, day, eligible, coalesce(first_reply_min <= 1440, false) as replied,
      first_reply_min is not null as answered, first_reply_min
    from (
      select p.author_id, p.topic, (p.created_at at time zone tz)::date as day,
        p.created_at <= now() - interval '24 hours' as eligible,
        (select extract(epoch from min(c.created_at) - p.created_at) / 60 from comments c
          where c.post_id = p.id and c.status <> 'deleted' and c.author_id <> p.author_id) as first_reply_min
      from posts p join profiles a on a.id = p.author_id and not a.is_house
      where p.status <> 'deleted' and p.created_at >= t0 and p.created_at < t1) q),
  m_comments as (
    select c.author_id, (c.created_at at time zone tz)::date as day
    from comments c join profiles a on a.id = c.author_id and not a.is_house
    where c.status <> 'deleted' and c.created_at >= t0 and c.created_at < t1),
  m_likes as (
    select l.user_id, (l.created_at at time zone tz)::date as day
    from likes l join profiles a on a.id = l.user_id and not a.is_house
    where l.created_at >= t0 and l.created_at < t1
    union all
    select l.user_id, (l.created_at at time zone tz)::date
    from comment_likes l join profiles a on a.id = l.user_id and not a.is_house
    where l.created_at >= t0 and l.created_at < t1),
  writes as (select author_id, day from m_posts union all select author_id, day from m_comments),
  extra_pairs as (
    select (e->>0)::uuid as who, (e->>1)::date as day
    from jsonb_array_elements(vote_pairs || reaction_pairs) e),
  activity as (
    select author_id as who, day from writes
    union all select user_id, day from m_likes
    union all select who, day from extra_pairs),
  active_by_day as (select day, count(distinct who) as n from activity group by day),
  new_by_day as (
    select (created_at at time zone tz)::date as day, count(*) as n
    from profiles where not is_house and created_at >= t0 and created_at < t1 group by 1),
  -- A new poster has a post in the window, so only those authors are looked up.
  new_posters as (
    select (min(p.created_at) at time zone tz)::date as day
    from posts p
    where p.status <> 'deleted' and p.author_id in (select author_id from m_posts)
    group by p.author_id
    having min(p.created_at) >= t0),
  hidden as (
    select (p.moderated_at at time zone tz)::date as day
    from posts p join profiles a on a.id = p.author_id and not a.is_house
    where p.status = 'hidden' and p.moderated_at >= t0 and p.moderated_at < t1),
  contributions as (select author_id, count(*) as n from writes group by author_id),
  -- One pass per day: every row tagged with its kind, then counted by kind.
  events as (
    select day, 'post' as kind, author_id as who, eligible, eligible and replied as replied from m_posts
    union all select day, 'comment', author_id, false, false from m_comments
    union all select day, 'like', user_id, false, false from m_likes
    union all select day, 'new_poster', null, false, false from new_posters
    union all select day, 'hidden', null, false, false from hidden),
  per_day as (
    select day,
      count(*) filter (where kind = 'post') as posts,
      count(*) filter (where kind = 'comment') as comments,
      count(*) filter (where kind = 'new_poster') as new_posters,
      count(*) filter (where kind = 'hidden') as hidden,
      count(*) filter (where kind = 'like') as likes,
      count(*) filter (where replied) as replied,
      count(*) filter (where eligible) as eligible,
      count(distinct who) filter (where kind in ('post', 'comment')) as contributors
    from events group by day)
  select jsonb_build_object(
    'tz', tz,
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'posts', coalesce(x.posts, 0),
        'comments', coalesce(x.comments, 0),
        'new_posters', coalesce(x.new_posters, 0),
        'hidden', coalesce(x.hidden, 0),
        'likes', coalesce(x.likes, 0),
        'poll_votes', case when vote_days is not null then coalesce((vote_days->>d.day::text)::int, 0) end,
        'reactions', case when reaction_days is not null then coalesce((reaction_days->>d.day::text)::int, 0) end,
        'replied_24h', coalesce(x.replied, 0),
        'reply_eligible', coalesce(x.eligible, 0),
        'contributors', coalesce(x.contributors, 0),
        'new_members', coalesce(nm.n, 0),
        'active_members', coalesce(am.n, 0)
      ) order by d.day), '[]'::jsonb) from days d left join per_day x on x.day = d.day
        left join new_by_day nm on nm.day = d.day left join active_by_day am on am.day = d.day),
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('topic', topic, 'count', n) order by n desc, topic), '[]')
      from (select coalesce(topic, '(sans)') as topic, count(*) as n from m_posts group by 1) t),
    'reply_rate', (select coalesce(count(*) filter (where replied)::float / nullif(count(*), 0), 0)
      from m_posts where eligible),
    'unanswered', (select count(*) from m_posts where eligible and not answered),
    'contributors', (select count(*) from contributions),
    'new_members', (select coalesce(sum(n), 0) from new_by_day),
    'active_members', (select count(distinct who) from activity),
    'members_total', (select count(*) from profiles where not is_house and created_at < t1),
    'median_first_reply_minutes', (select percentile_cont(0.5) within group (order by first_reply_min)
      from m_posts where eligible and first_reply_min is not null),
    'reactors', (select count(distinct u) from (
        select user_id as u from m_likes
        union all select (e->>0)::uuid from jsonb_array_elements(vote_pairs) e
        union all select (e->>0)::uuid from jsonb_array_elements(reaction_pairs) e) r
      where u not in (select author_id from contributions)),
    'contribution_buckets', (select jsonb_build_object(
        '1', count(*) filter (where n = 1),
        '2-3', count(*) filter (where n between 2 and 3),
        '4-7', count(*) filter (where n between 4 and 7),
        '8+', count(*) filter (where n >= 8)) from contributions))
  into result;
  return result;
end;
$$;

revoke execute on function public.admin_daily_metrics(date, date, text) from public, anon, authenticated;

create or replace function public.admin_activity_breakdown(from_date date, to_date date, tz text default 'UTC')
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  t0 timestamptz;
  t1 timestamptz;
  pt0 timestamptz;  -- the previous period: as many days, right before from_date
  polls jsonb;
  -- profiles.locale comes from the push module: without it, languages is null.
  has_locale boolean := exists (select 1 from pg_attribute
    where attrelid = 'public.profiles'::regclass and attname = 'locale' and not attisdropped);
  result jsonb;
begin
  if tz is null or tz not in (select name from pg_timezone_names) then
    raise exception 'invalid_time_zone' using errcode = '22023';
  end if;
  t0 := from_date::timestamp at time zone tz;
  t1 := (to_date + 1)::timestamp at time zone tz;
  pt0 := (from_date - greatest(to_date - from_date + 1, 0))::timestamp at time zone tz;

  with
  -- Member posts and comments (not deleted) of both periods; locale is read through to_jsonb
  -- so the function also compiles where the push module's column does not exist.
  writes as (
    select p.author_id, p.created_at, case when has_locale then to_jsonb(a)->>'locale' end as locale
    from posts p join profiles a on a.id = p.author_id and not a.is_house
    where p.status <> 'deleted' and p.created_at >= pt0 and p.created_at < t1
    union all
    select c.author_id, c.created_at, case when has_locale then to_jsonb(a)->>'locale' end
    from comments c join profiles a on a.id = c.author_id and not a.is_house
    where c.status <> 'deleted' and c.created_at >= pt0 and c.created_at < t1),
  cur as (select * from writes where created_at >= t0),
  heat as (
    select extract(isodow from created_at at time zone tz)::int - 1 as dow,
      extract(hour from created_at at time zone tz)::int as hr, count(*) as n
    from cur group by 1, 2),
  mod as (
    select w.k,
      (select count(*) from reports r join profiles a on a.id = r.reporter_id and not a.is_house
        where r.created_at >= w.a and r.created_at < w.b) as reports,
      (select count(*) from (
          select 1 from posts p join profiles a on a.id = p.author_id and not a.is_house
          where p.moderation_reason is not null and p.moderated_at >= w.a and p.moderated_at < w.b
          union all
          select 1 from comments c join profiles a on a.id = c.author_id and not a.is_house
          where c.moderation_reason is not null and c.moderated_at >= w.a and c.moderated_at < w.b) q) as ai_hidden,
      (select count(*) from moderation_actions m where m.created_at >= w.a and m.created_at < w.b
        and m.action in ('hide','restore','confirm_hide','reject_report','ban','unban')) as team_actions
    from (values ('cur', t0, t1), ('prev', pt0, t0)) w(k, a, b)),
  top as (select * from (
    -- image_path and attachment come from optional modules: read through to_jsonb so their absence is null.
    select p.id, p.content, to_jsonb(p)->>'image_path' as image_path, to_jsonb(p)->'attachment' as attachment, p.topic, p.author_id, a.username as author_name, p.created_at,
      (select count(*) from likes l join profiles u on u.id = l.user_id and not u.is_house where l.post_id = p.id) as likes,
      (select count(*) from comments c join profiles u on u.id = c.author_id and not u.is_house
        where c.post_id = p.id and c.status <> 'deleted') as comments
    from posts p join profiles a on a.id = p.author_id and not a.is_house
    where p.status <> 'deleted' and p.created_at >= t0 and p.created_at < t1) q
    order by likes + comments desc, created_at desc, id limit 5)
  select jsonb_build_object(
    'tz', tz,
    'heatmap', (select jsonb_agg((select jsonb_agg(coalesce((select n from heat where heat.dow = d and heat.hr = hh), 0) order by hh)
        from generate_series(0, 23) hh) order by d) from generate_series(0, 6) d),
    'languages', case when has_locale then (select coalesce(jsonb_agg(jsonb_build_object('locale', locale, 'count', n)
        order by n desc, locale), '[]') from (select locale, count(*) as n from cur group by locale) l) end,
    'moderation', (select jsonb_build_object('reports', c.reports, 'ai_hidden', c.ai_hidden, 'team_actions', c.team_actions,
        'previous', jsonb_build_object('reports', v.reports, 'ai_hidden', v.ai_hidden, 'team_actions', v.team_actions))
      from mod c, mod v where c.k = 'cur' and v.k = 'prev'),
    'returning', jsonb_build_object(
      'previous_contributors', (select count(distinct author_id) from writes where created_at < t0),
      'returned', (select count(distinct author_id) from cur
        where author_id in (select author_id from writes where created_at < t0))),
    'top_posts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'content', content, 'image_path', image_path,
        'attachment', attachment, 'poll', null, 'topic', topic,
        'author_id', author_id, 'author_name', author_name, 'likes', likes, 'comments', comments,
        'created_at', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        order by likes + comments desc, created_at desc, id), '[]') from top))
  into result;
  -- A top post's poll (polls module): its options in order with their vote counts.
  if to_regclass('public.poll_options') is not null and jsonb_array_length(result->'top_posts') > 0 then
    execute $q$select coalesce(jsonb_object_agg(post_id, opts), '{}') from (
        select o.post_id, jsonb_agg(jsonb_build_object('label', o.label,
          'votes', (select count(*) from public.poll_votes v where v.option_id = o.id)) order by o.idx) as opts
        from public.poll_options o where o.post_id = any($1) group by o.post_id) x$q$
      into polls
      using (select array_agg((e->>'id')::uuid) from jsonb_array_elements(result->'top_posts') e);
    result := jsonb_set(result, '{top_posts}', (select jsonb_agg(jsonb_set(e, '{poll}', coalesce(polls->(e->>'id'), 'null'))
      order by n) from jsonb_array_elements(result->'top_posts') with ordinality t(e, n)));
  end if;
  return result;
end;
$$;

revoke execute on function public.admin_activity_breakdown(date, date, text) from public, anon, authenticated;
