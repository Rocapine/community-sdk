-- community-sdk inbox/005_group_events.sql (schema v1)
-- Group events in the center (groups module): group_approved, group_field_rejected and
-- group_member_removed name their group in notifications.conversation_id, which
-- list_notifications() now returns (null on every other kind). The column is added in
-- any install order so inbox works without messaging: its foreign key to conversations
-- (on delete cascade) is added here when messaging is already in, else by groups/001.
-- Same rows and filters as inbox/004 (blocks, official posts, read state untouched).
-- A new return column needs a drop: grants are restated as in inbox/001.

alter table public.notifications add column if not exists conversation_id uuid;
do $$
begin
  if to_regclass('public.conversations') is not null
     and not exists (select 1 from pg_constraint
                     where conrelid = 'public.notifications'::regclass
                       and conname = 'notifications_conversation_id_fkey') then
    -- Added unchecked, then checked: the check doesn't block writes to notifications.
    alter table public.notifications
      add constraint notifications_conversation_id_fkey
      foreign key (conversation_id) references public.conversations(id) on delete cascade
      not valid;
    alter table public.notifications validate constraint notifications_conversation_id_fkey;
  end if;
end $$;

drop function if exists public.list_notifications(int);
create function public.list_notifications(p_limit int default 50)
returns table (
  id uuid,
  kind text,
  actor_id uuid,
  actor_username text,
  post_id uuid,
  post_excerpt text,
  created_at timestamptz,
  conversation_id uuid
)
language sql stable security definer set search_path = public
as $$
  with hidden as (select public.blocked_member_ids() as ids)
  (
    select n.id, n.kind, n.actor_id, pr.username, n.post_id,
           left(p.content, 140), n.created_at, n.conversation_id
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
           left(p.content, 140), p.broadcast_at, null::uuid
    from posts p
    join profiles pr on pr.id = p.author_id
    where p.status = 'visible' and p.broadcast_at is not null
      and p.author_id <> auth.uid()
      and p.broadcast_at > now() - interval '90 days'
  )
  order by created_at desc
  limit p_limit;
$$;

revoke execute on function public.list_notifications(int) from public, anon;
grant execute on function public.list_notifications(int) to authenticated;
