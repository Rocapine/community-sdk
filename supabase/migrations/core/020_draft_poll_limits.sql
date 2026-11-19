-- community-sdk core/020_draft_poll_limits.sql (schema v1)
-- Drafts follow the project's poll limits (polls/002, poll_set_limits) instead of the fixed 2 to 4
-- options of up to 60 characters. check_post_draft (core/015) is redefined with that one change; a
-- backend without polls/002 keeps the old limits. Requires core/015. Fully idempotent.

create or replace function public.check_post_draft(d post_drafts, p_at timestamptz default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  author profiles;
  n int;
  min_n int := 2;
  max_n int := 4;
  max_len int := 60;
begin
  select * into author from profiles where id = d.author_id;
  if not found or not author.is_house then raise exception 'not_a_team_account'; end if;
  if author.is_banned then raise exception 'author_banned'; end if;
  if (d.pin or d.notify) and not author.is_admin then raise exception 'not_admin'; end if;

  -- Like posts_content_check: text is optional when there is an image.
  if char_length(d.content) > 2000 or (char_length(d.content) = 0 and d.image_path is null) then
    raise exception 'invalid_content';
  end if;
  -- Mirrors posts_image_check and posts_image_path_format (images/001). The image lives
  -- in the author's storage folder; the dashboard moves it when the author changes.
  if d.image_path is not null and (coalesce(d.image_width, 0) <= 0 or coalesce(d.image_height, 0) <= 0
    or d.image_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.jpg$'
    or split_part(d.image_path, '/', 1) <> d.author_id::text) then
    raise exception 'invalid_image';
  end if;
  n := coalesce(array_length(d.poll_options, 1), 0);
  if d.poll_options is not null and to_regprocedure('public.poll_limits()') is not null then
    select l.min_options, l.max_options, l.option_max_length into min_n, max_n, max_len
      from public.poll_limits() l;
  end if;
  if d.poll_options is not null and (n not between min_n and max_n
    or exists (select 1 from unnest(d.poll_options) l where coalesce(char_length(l), 0) not between 1 and max_len)) then
    raise exception 'invalid_poll';
  end if;
  -- Mirrors posts_attachment_check (attachments/001); coalesce because a null check result would pass.
  if d.attachment is not null and not coalesce(jsonb_typeof(d.attachment) = 'object'
    and d.attachment ? 'type' and d.attachment ? 'id'
    and jsonb_typeof(d.attachment -> 'type') = 'string' and jsonb_typeof(d.attachment -> 'id') = 'string'
    and octet_length(d.attachment::text) <= 512, false) then
    raise exception 'invalid_attachment';
  end if;
  if (d.image_path is not null)::int + (d.poll_options is not null)::int + (d.attachment is not null)::int > 1 then
    raise exception 'one_extra_only';
  end if;
  -- Topic rules live in the dashboard; here a draft only needs one, so the cron never posts without it.
  if d.topic is null then raise exception 'invalid_topic'; end if;
  perform check_post_draft_window(d, p_at);
end;
$$;

revoke execute on function public.check_post_draft(post_drafts, timestamptz) from public, anon, authenticated;
