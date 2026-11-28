-- community-sdk groups/005_storage_sweep.sql
-- Files of the messaging buckets nothing needs any more, for the daily sweep
-- (daily-moderation) to remove with the service role:
--  - every image of a deleted group: its picture (`group-images/<group>/…`) and its
--    messages' images (`message-images/<group>/…`). Deleting a group is final;
--  - uploads no row points at, older than a day (a picked image never sent, a group
--    form abandoned, a lost race in moderation): a group picture no live group uses,
--    a pending picture no live group waits on, a message image no message nor
--    message version holds.
-- A file still referenced by a group or message that isn't deleted is never listed.
-- Idempotent.

create index if not exists message_versions_image_path_idx
  on public.message_versions (image_path) where image_path is not null;

create or replace function public.messaging_images_unreferenced(p_limit int default 500)
returns table (bucket text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  with deleted_groups as (
    select g.conversation_id::text as id from public.groups g where g.status = 'deleted'
  )
  select o.bucket_id, o.name
  from storage.objects o
  where (
      o.bucket_id = 'group-images'
      and not exists (select 1 from public.groups g
                      where g.image_path = o.name and g.status <> 'deleted')
      and (o.created_at < now() - interval '1 day'
           or split_part(o.name, '/', 1) in (select id from deleted_groups))
    ) or (
      o.bucket_id = 'group-images-pending'
      and o.created_at < now() - interval '1 day'
      and not exists (select 1 from public.groups g
                      where g.pending_image_path = o.name and g.status <> 'deleted')
    ) or (
      o.bucket_id = 'message-images'
      and (
        split_part(o.name, '/', 1) in (select id from deleted_groups)
        or (o.created_at < now() - interval '1 day'
            and not exists (select 1 from public.messages m where m.image_path = o.name)
            and not exists (select 1 from public.message_versions v where v.image_path = o.name))
      )
    )
  order by o.created_at
  limit p_limit;
$$;

revoke execute on function public.messaging_images_unreferenced(int) from public, anon, authenticated;
