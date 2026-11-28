-- community-sdk groups/003_list_conversations.sql (schema v1)
-- Groups module: list_conversations() also returns each group's live title, picture
-- and status, so the Messages page draws its rows from one call instead of one
-- group read per row. Live columns only: pending_* (a creator's unreviewed values)
-- never leave the table through here, and a group that isn't visible (pending, hidden)
-- shows them to its creator only, as the groups table's read rule does. Every column of messaging/001 stays, in order.
-- The return type changes, so the function is dropped and created again (a SQL body
-- isn't a tracked dependency: unread_followed_messages keeps working). Requires
-- messaging/001 and groups/001. Idempotent.
-- With the dms module, dms/001 owns later versions of list_conversations: a new
-- migration that replaces it must keep its DM rules (visible_from, blocks), then re-run
-- supabase-tests/dms.sql.

drop function if exists public.list_conversations();

create function public.list_conversations()
returns table (
  conversation_id uuid,
  kind text,
  last_message_at timestamptz,
  last_message_id uuid,
  last_body text,
  last_author_id uuid,
  unread int,
  notify boolean,
  role text,
  title text,
  image_path text,
  group_status text
)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids)
  select c.id, c.kind, c.last_message_at, lm.id, lm.body, lm.author_id,
    (select count(*)::int from (
       select 1 from messages m
       where m.conversation_id = c.id and m.status = 'visible' and m.author_id <> auth.uid()
         and m.created_at > coalesce(cm.last_read_at, cm.joined_at)
         and not (m.author_id = any (b.ids))
       limit 99
     ) u),
    cm.notify, cm.role,
    case when gv.ok then g.name end,
    case when gv.ok then g.image_path end,
    case when gv.ok then g.status end
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id
  left join groups g on g.conversation_id = c.id
  cross join lateral (
    select g.status = 'visible' or g.created_by = auth.uid() as ok
  ) gv
  cross join b
  left join lateral (
    select m.id, m.body, m.author_id from messages m
    where m.conversation_id = c.id
      and (m.status in ('visible', 'deleted') or m.author_id = auth.uid())
      and not (m.author_id = any (b.ids))
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where cm.user_id = auth.uid() and cm.state = 'active'
  order by coalesce(c.last_message_at, c.created_at) desc;
$$;

revoke execute on function public.list_conversations() from public, anon;
grant execute on function public.list_conversations() to authenticated;
