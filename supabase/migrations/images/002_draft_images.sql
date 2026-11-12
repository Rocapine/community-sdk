-- community-sdk images/002_draft_images.sql (schema v1)
-- The nightly sweep keeps images that a shared post draft (core/014_post_drafts.sql)
-- points at, so a draft written yesterday still has its picture today.
-- Redefines post_images_unreferenced with one more reference check. Idempotent.

create or replace function public.post_images_unreferenced(p_limit int default 500)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'post-images'
    and o.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.posts p
      where p.image_path = o.name and p.status <> 'deleted'
    )
    and not exists (
      select 1 from public.comments c
      where c.image_path = o.name and c.status <> 'deleted'
    )
    and not exists (
      select 1 from public.post_drafts d
      where d.image_path = o.name
    )
  order by o.created_at
  limit p_limit;
$$;

revoke all on function public.post_images_unreferenced(int) from public, anon, authenticated;
grant execute on function public.post_images_unreferenced(int) to service_role;
