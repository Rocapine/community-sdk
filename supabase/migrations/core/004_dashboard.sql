-- community-sdk core/004_dashboard.sql (schema v1)
-- Community SDK — 04 dashboard support: what the Rocactopus dashboard needs
-- to moderate this app (admin allow-list, audit log, aggregation view,
-- metrics RPC). The review/resolution columns live in core/001_tables.sql.
--
-- admin_user_stats and admin_daily_metrics are service-role/dashboard only:
-- the view runs with security_invoker=off (so it can see every row) and both
-- expose PII (amplitude_id, revenuecat_id, is_banned) — client roles must
-- never be able to select/execute them.

create table public.admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
-- No policy: readable only by the service role.

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  action text not null check (action in
    ('hide','restore','confirm_hide','reject_report','ban','unban')),
  target_post_id uuid references public.posts(id) on delete set null,
  target_comment_id uuid references public.comments(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.moderation_actions enable row level security;
create index moderation_actions_user_idx on public.moderation_actions (target_user_id, created_at desc);

create view public.admin_user_stats
with (security_invoker = off) as
select
  p.id, p.username, p.is_banned, p.is_house, p.created_at,
  p.amplitude_id, p.revenuecat_id,
  (select count(*) from posts    where author_id = p.id and status <> 'deleted') as post_count,
  (select count(*) from comments where author_id = p.id and status <> 'deleted') as comment_count,
  (select count(*) from posts    where author_id = p.id and status = 'hidden')
    + (select count(*) from comments where author_id = p.id and status = 'hidden') as hidden_count,
  (select count(*) from reports  where reported_user_id = p.id) as reports_received,
  (select count(*) from blocks   where blocked_id = p.id) as blocked_by_count
from profiles p;

revoke select on public.admin_user_stats from public, anon, authenticated;

-- Daily series for /overview in one call. Adoption metrics exclude house accounts.
create or replace function public.admin_daily_metrics(from_date date, to_date date)
returns jsonb
language sql
stable
as $$
  with days as (
    select generate_series(from_date, to_date, interval '1 day')::date as day
  ),
  human as (select id from profiles where is_house = false),
  daily_posts as (
    select p.created_at::date as day, count(*) as n
    from posts p
    where p.status <> 'deleted' and p.created_at::date between from_date and to_date
    group by 1),
  daily_comments as (
    select c.created_at::date as day, count(*) as n
    from comments c
    where c.status <> 'deleted' and c.created_at::date between from_date and to_date
    group by 1),
  first_post as (
    select author_id, min(created_at)::date as first_day
    from posts where author_id in (select id from human) group by author_id),
  new_posters as (
    select first_day as day, count(*) as n from first_post
    where first_day between from_date and to_date group by 1),
  daily_hidden as (
    select moderated_at::date as day, count(*) as n
    from posts where status='hidden' and moderated_at::date between from_date and to_date
    group by 1),
  topics as (
    select coalesce(topic,'(sans)') as topic, count(*) as n
    from posts where status <> 'deleted' and created_at::date between from_date and to_date
    group by 1),
  reply_rate as (
    select count(*) filter (where exists (
        select 1 from comments c
        where c.post_id = p.id and c.created_at <= p.created_at + interval '24 hours'))::float
      / nullif(count(*),0) as rate
    from posts p
    where p.status <> 'deleted' and p.author_id in (select id from human)
      and p.created_at::date between from_date and to_date)
  select jsonb_build_object(
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day, 'posts', coalesce(dp.n,0), 'comments', coalesce(dc.n,0),
        'new_posters', coalesce(np.n,0), 'hidden', coalesce(dh.n,0)) order by d.day), '[]'::jsonb)
      from days d
      left join daily_posts dp on dp.day=d.day
      left join daily_comments dc on dc.day=d.day
      left join new_posters np on np.day=d.day
      left join daily_hidden dh on dh.day=d.day),
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('topic',topic,'count',n) order by n desc),'[]'::jsonb) from topics),
    'reply_rate', (select coalesce(rate,0) from reply_rate));
$$;

revoke execute on function public.admin_daily_metrics(date, date) from public, anon, authenticated;
