-- community-sdk reaction/004_mutual_blocks.sql (schema v1)
-- The reaction summary follows blocks (core/016_mutual_blocks.sql): a member
-- blocked either way is neither counted nor named as the last reactor, and only
-- posts the caller can read are summarized (the function is SECURITY DEFINER, so
-- it applies the posts rule itself). Same return shape as reaction/001.

create or replace function public.post_reaction_summary(p_post_ids uuid[])
returns table (post_id uuid, reaction_count int, last_reactor_name text, has_reacted boolean)
language sql stable security definer set search_path = public
as $$
  with hidden as (select public.blocked_member_ids() as ids),
  shown as (
    select r.post_id, r.user_id, r.created_at
    from post_reactions r
    join posts p on p.id = r.post_id
    cross join hidden h
    where r.post_id = any (p_post_ids)
      and (p.author_id = auth.uid()
           or (p.status = 'visible' and not (p.author_id = any (h.ids))))
      and not (r.user_id = any (h.ids))
  )
  select
    s.post_id,
    count(*)::int as reaction_count,
    (
      select pr.username
      from shown s2
      join profiles pr on pr.id = s2.user_id
      where s2.post_id = s.post_id
      order by s2.created_at desc
      limit 1
    ) as last_reactor_name,
    bool_or(s.user_id = auth.uid()) as has_reacted
  from shown s
  group by s.post_id;
$$;
