-- The post and comment length limit (2000 / 1000) applies to new writing, not to history.
-- It moves from CHECK constraints (which every row must satisfy forever) to a trigger that an
-- importer can switch off: alter table public.posts disable trigger user (and comments).
-- Idempotent.

create or replace function public.enforce_content_length()
returns trigger language plpgsql set search_path = '' as $$
declare
  max_len int := case tg_table_name when 'posts' then 2000 else 1000 end;
begin
  if char_length(new.content) > max_len then
    raise exception 'content is longer than % characters', max_len using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists posts_content_length on public.posts;
create trigger posts_content_length
  before insert or update of content on public.posts
  for each row execute function public.enforce_content_length();

drop trigger if exists comments_content_length on public.comments;
create trigger comments_content_length
  before insert or update of content on public.comments
  for each row execute function public.enforce_content_length();

-- The checks keep only the minimum. With the images module the text is optional when there is an
-- image (images/001 added image_path), so keep that branch when the column exists.
do $$
declare
  t text;
  cond text;
begin
  foreach t in array array['posts', 'comments'] loop
    cond := 'char_length(content) >= 1';
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = t and column_name = 'image_path') then
      cond := cond || ' or image_path is not null';
    end if;
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_content_check');
    execute format('alter table public.%I add constraint %I check (%s)', t, t || '_content_check', cond);
  end loop;
end $$;
