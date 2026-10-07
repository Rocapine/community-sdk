-- community-sdk translation/002_webhooks.sql (schema v1)
-- Community SDK — translation module: translate webhooks, triggers and the
-- daily sweep cron, built on the project settings helpers
-- (core/000_settings.sql). Requires the translate-one / daily-translation
-- Edge Functions. On an existing install this replaces the functions and job
-- that carried the project URL baked in.

-- ============ TRIGGERS ============
create or replace function public.translate_post_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.community_call_function('translate-one', jsonb_build_object('kind', 'post', 'id', new.id));
  return new;
end; $$;

create or replace function public.translate_comment_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.community_call_function('translate-one', jsonb_build_object('kind', 'comment', 'id', new.id));
  return new;
end; $$;

drop trigger if exists on_post_published_translate on public.posts;
create trigger on_post_published_translate
  after update of status on public.posts for each row
  when (old.status = 'pending' and new.status = 'visible')
  execute function public.translate_post_webhook();
drop trigger if exists on_post_created_visible_translate on public.posts;
create trigger on_post_created_visible_translate
  after insert on public.posts for each row
  when (new.status = 'visible')
  execute function public.translate_post_webhook();

drop trigger if exists on_comment_published_translate on public.comments;
create trigger on_comment_published_translate
  after update of status on public.comments for each row
  when (old.status = 'pending' and new.status = 'visible')
  execute function public.translate_comment_webhook();
drop trigger if exists on_comment_created_visible_translate on public.comments;
create trigger on_comment_created_visible_translate
  after insert on public.comments for each row
  when (new.status = 'visible')
  execute function public.translate_comment_webhook();

-- ============ CRON ============
-- Daily sweep at 08:30 UTC (after the 08:00 moderation sweep): back-fills the
-- history on first installation, then catches anything translate-one missed.
select public.community_schedule(
  'community-translation-sweep',
  '30 8 * * *',
  $cron$ select public.community_call_function('daily-translation'); $cron$
);
