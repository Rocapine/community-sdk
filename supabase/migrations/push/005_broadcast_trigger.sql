-- community-sdk push/005_broadcast_trigger.sql (schema v1)
-- Sends an admin post to everyone (broadcast-post) once it is visible and was asked
-- for (core/013_post_broadcasts.sql): on a visible insert, on publication by
-- moderation, or when asked after publication. broadcast-post stamps `broadcast_at`
-- before sending, so a post goes out at most once.

create or replace function public.broadcast_post_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.community_call_function('broadcast-post', jsonb_build_object('post_id', new.id));
  return new;
end; $$;

create or replace trigger on_post_broadcast_ready
  after insert or update of status, broadcast_requested on public.posts
  for each row
  when (new.status = 'visible' and new.broadcast_requested and new.broadcast_at is null)
  execute function public.broadcast_post_webhook();
