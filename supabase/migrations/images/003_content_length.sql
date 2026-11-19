-- The length maximum now lives in the core triggers (core/018_content_length.sql), so an importer
-- can switch it off. images/001 puts the maximum back in the checks on a fresh install (it runs
-- after core): take it out again. Idempotent.
alter table public.posts drop constraint if exists posts_content_check;
alter table public.posts add constraint posts_content_check check (
  char_length(content) >= 1 or image_path is not null
);
alter table public.comments drop constraint if exists comments_content_check;
alter table public.comments add constraint comments_content_check check (
  char_length(content) >= 1 or image_path is not null
);
