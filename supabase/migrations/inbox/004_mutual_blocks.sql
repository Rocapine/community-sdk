-- community-sdk inbox/004_mutual_blocks.sql (schema v1)
-- The center follows blocks, past ones included: an item whose actor, or whose
-- post's author, is blocked either way (core/016_mutual_blocks.sql) is no longer
-- listed. Nothing is deleted, so an unblock brings the items back. Same return
-- shape as inbox/003, so installed app versions read it unchanged.

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
  with hidden as (select public.blocked_member_ids() as ids)
  (
    select n.id, n.kind, n.actor_id, pr.username, n.post_id,
           left(p.content, 140), n.created_at
    from notifications n
    cross join hidden h
    left join profiles pr on pr.id = n.actor_id
    left join posts p on p.id = n.post_id
    where n.user_id = auth.uid()
      and (n.post_id is null or p.status in ('visible', 'pending'))
      and (n.actor_id is null or not (n.actor_id = any (h.ids)))
      and (p.author_id is null or p.author_id = auth.uid() or not (p.author_id = any (h.ids)))
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
