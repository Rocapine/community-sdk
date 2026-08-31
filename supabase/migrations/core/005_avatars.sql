-- community-sdk core/005_avatars.sql (schema v1)
-- Community SDK — 05 avatars Storage bucket.
-- Public read (avatar URLs are plain public object URLs), 1MB cap, JPEG only.
-- Uploads land at avatars/{uid}/{timestamp}.jpg and are pending until the
-- update-profile Edge Function approves them; a rejected object is deleted by
-- the function. An unapproved object is technically fetchable at its URL until
-- then, but the URL is unguessable in practice and never linked. Accepted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 1048576, array['image/jpeg'])
  on conflict (id) do nothing;

-- Clients may only CREATE objects inside their own folder. No UPDATE/DELETE
-- policies: replacement cleanup is done by the function with the service role.
create policy "avatar upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
