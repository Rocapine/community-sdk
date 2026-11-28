-- community-sdk dms/009_storage_sweep.sql
-- The daily sweep of chat images (daily-moderation calls messaging_images_unreferenced)
-- for installs with dms and without groups: that function came only with groups/005, so a
-- DM-only install kept the image files of erased DM messages and of uploads never sent
-- (an image picked before a first message the server refused). Created here only when
-- groups hasn't made it: the same rules as groups/006 for `message-images` (the only
-- messaging bucket without groups), a file no message nor message version holds, older
-- than a day, and never one an open report points at (the reported message's image, now
-- or in its history). Adding groups later replaces it with groups/005–006's, which also
-- sweeps the group buckets; running this file again never replaces theirs.
-- Requires messaging/001. Idempotent.

create index if not exists message_versions_image_path_idx
  on public.message_versions (image_path) where image_path is not null;

do $do$
begin
  if to_regprocedure('public.messaging_images_unreferenced(int)') is not null then
    return;
  end if;
  execute $fn$
    create function public.messaging_images_unreferenced(p_limit int default 500)
    returns table (bucket text, name text)
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      with reported_images as (
        select m.image_path as path from public.reports r
        join public.messages m on m.id = r.message_id
        where r.status = 'open' and m.image_path is not null
        union
        select v.image_path from public.reports r
        join public.message_versions v on v.message_id = r.message_id
        where r.status = 'open' and v.image_path is not null
      )
      select o.bucket_id, o.name
      from storage.objects o
      where o.bucket_id = 'message-images'
        and o.created_at < now() - interval '1 day'
        and not exists (select 1 from public.messages m where m.image_path = o.name)
        and not exists (select 1 from public.message_versions v where v.image_path = o.name)
        and o.name not in (select path from reported_images)
      order by o.created_at
      limit p_limit;
    $$
  $fn$;
end
$do$;

revoke execute on function public.messaging_images_unreferenced(int) from public, anon, authenticated;
