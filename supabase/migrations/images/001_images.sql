-- community-sdk images/001_images.sql (schema v1)
-- Images module: one optional image per post and per comment.
-- Columns hold the Storage object name in the public `post-images` bucket
-- ({uid}/{uuid}.jpg) plus the dimensions the client needs to lay the frame out
-- before the bytes arrive. Public read (plain public object URLs), 2MB cap,
-- JPEG only (the client re-encodes on device, which also strips EXIF/GPS).
-- Unlike avatars, a hidden item KEEPS its file; the daily sweep removes only
-- objects no live (status <> 'deleted') row references, via
-- post_images_unreferenced() below. Fully idempotent.

-- ============ COLUMNS ============
alter table public.posts
  add column if not exists image_path text,
  add column if not exists image_width int,
  add column if not exists image_height int;
alter table public.comments
  add column if not exists image_path text,
  add column if not exists image_width int,
  add column if not exists image_height int;

-- Dimensions are set iff the path is set, and positive.
alter table public.posts drop constraint if exists posts_image_check;
alter table public.posts add constraint posts_image_check check (
  (image_path is null and image_width is null and image_height is null)
  or (image_path is not null and image_width > 0 and image_height > 0)
);
alter table public.comments drop constraint if exists comments_image_check;
alter table public.comments add constraint comments_image_check check (
  (image_path is null and image_width is null and image_height is null)
  or (image_path is not null and image_width > 0 and image_height > 0)
);

-- The path is `{uid}/{name}.jpg` (name: a uuid, or the client's
-- `{Date.now()}-{base36}` fallback when crypto.randomUUID is missing), so a
-- crafted insert can't point at another bucket path or a non-JPEG name.
alter table public.posts drop constraint if exists posts_image_path_format;
alter table public.posts add constraint posts_image_path_format check (
  image_path is null or image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.jpg$'
);
alter table public.comments drop constraint if exists comments_image_path_format;
alter table public.comments add constraint comments_image_path_format check (
  image_path is null or image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.jpg$'
);

-- Text becomes optional when an image is present (image-only items store '').
-- core/001_tables.sql leaves the inline check auto-named <table>_content_check.
alter table public.posts drop constraint if exists posts_content_check;
alter table public.posts add constraint posts_content_check check (
  char_length(content) <= 2000 and (char_length(content) >= 1 or image_path is not null)
);
alter table public.comments drop constraint if exists comments_content_check;
alter table public.comments add constraint comments_content_check check (
  char_length(content) <= 1000 and (char_length(content) >= 1 or image_path is not null)
);

-- ============ CLIENT WRITE ACCESS ============
-- Both tables use column-scoped insert grants (core/002_rls.sql); extend them.
grant insert (image_path, image_width, image_height) on table public.posts to authenticated;
grant insert (image_path, image_width, image_height) on table public.comments to authenticated;

-- Restrictive: ANDed with the existing permissive insert policies, so an image
-- can only point into the author's own storage folder.
drop policy if exists "post image in own folder" on public.posts;
create policy "post image in own folder"
  on public.posts as restrictive for insert to authenticated
  with check (
    image_path is null or (storage.foldername(image_path))[1] = auth.uid()::text
  );
drop policy if exists "comment image in own folder" on public.comments;
create policy "comment image in own folder"
  on public.comments as restrictive for insert to authenticated
  with check (
    image_path is null or (storage.foldername(image_path))[1] = auth.uid()::text
  );

-- ============ STORAGE ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('post-images', 'post-images', true, 2097152, array['image/jpeg'])
  on conflict (id) do nothing;

-- Clients may only CREATE objects inside their own folder. No UPDATE/DELETE
-- policies: removal is done by the Edge Functions with the service role.
drop policy if exists "post image upload to own folder" on storage.objects;
create policy "post image upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============ SWEEP ============
-- Object names older than 24h that no live post/comment references: abandoned
-- uploads, plus files of deleted items. Hidden items stay referenced (file
-- kept). Service role only (called by daily-moderation).
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
  order by o.created_at
  limit p_limit;
$$;

revoke all on function public.post_images_unreferenced(int) from public, anon, authenticated;
grant execute on function public.post_images_unreferenced(int) to service_role;
