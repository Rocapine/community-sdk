-- community-sdk attachments/001_attachments.sql (schema v1)
-- Attachments module: one reference to the app's own content per post (a verse, a
-- recipe, a session), `{ "type": "verse", "id": "43.3.16" }`. The post never stores a
-- URL, a title or an image: each reader's app draws the card from its own data, and
-- its button opens that content in the app. Which types exist, and who may attach,
-- is the app's configuration. Client-written: a shape and size check is the only
-- guard. Fully idempotent.

alter table public.posts add column if not exists attachment jsonb;

alter table public.posts drop constraint if exists posts_attachment_check;
alter table public.posts add constraint posts_attachment_check check (
  attachment is null or (
    jsonb_typeof(attachment) = 'object'
    -- `?` first: a missing key would make jsonb_typeof null, which a check lets pass.
    and attachment ? 'type'
    and attachment ? 'id'
    and jsonb_typeof(attachment -> 'type') = 'string'
    and jsonb_typeof(attachment -> 'id') = 'string'
    and octet_length(attachment::text) <= 512
  )
);

-- Text becomes optional when an attachment is present. The check is rebuilt from
-- the columns that exist, so the images module (which also relaxes it) can be
-- installed before or after this one.
do $$
declare
  has_image boolean := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'image_path'
  );
begin
  alter table public.posts drop constraint if exists posts_content_check;
  execute format(
    'alter table public.posts add constraint posts_content_check check (char_length(content) <= 2000 and (char_length(content) >= 1%s or attachment is not null))',
    case when has_image then ' or image_path is not null' else '' end
  );
end $$;

-- Posts use column-scoped insert grants (core/002_rls.sql); extend them.
grant insert (attachment) on table public.posts to authenticated;
grant select (attachment) on table public.posts to anon, authenticated;
