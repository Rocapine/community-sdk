-- community-sdk inbox/003_pushed_admin_posts.sql (schema v1)
-- The notification center is the history of the pushes: an admin post is listed
-- only once it was sent to everyone (`posts.broadcast_at`, core/013), dated when it
-- was sent. Admin posts that were never pushed leave the center. Same return shape
-- as before, so installed app versions read it unchanged.

create or replace function public.list_notifications(p_limit int default 50)
returns table (
  id uuid,
  kind text,
  actor_id uuid,
  actor_username text,
  post_id uuid,
  post_excerpt text,
  created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  (
    select n.id, n.kind, n.actor_id, pr.username, n.post_id,
           left(p.content, 140), n.created_at
    from notifications n
    left join profiles pr on pr.id = n.actor_id
    left join posts p on p.id = n.post_id
    where n.user_id = auth.uid()
      and (n.post_id is null or p.status in ('visible', 'pending'))
  )
  union all
  (
    select p.id, 'official_post', p.author_id, pr.username, p.id,
           left(p.content, 140), p.broadcast_at
    from posts p
    join profiles pr on pr.id = p.author_id
    where p.status = 'visible' and p.broadcast_at is not null
      and p.author_id <> auth.uid()
      and p.broadcast_at > now() - interval '90 days'
  )
  order by created_at desc
  limit p_limit;
$$;
