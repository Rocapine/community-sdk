-- community-sdk core/013_post_broadcasts.sql (schema v1)
-- "Notify everyone" for admin posts. An admin asks for it on their own post
-- (request_post_broadcast); the push module's broadcast-post sends it once the post
-- is visible, even when moderation publishes it later, and stamps `broadcast_at`.
-- The inbox lists an admin post only once it is stamped, so the notification
-- center shows exactly the admin posts that were pushed.
-- Both columns stay out of the client's grants; this function is the only client path.

alter table public.posts
  add column if not exists broadcast_requested boolean not null default false,
  add column if not exists broadcast_at timestamptz;

create or replace function public.request_post_broadcast(p_post_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.current_user_admin() then
    raise exception 'only admins notify everyone' using errcode = '42501';
  end if;
  update posts set broadcast_requested = true
  where id = p_post_id and author_id = auth.uid();
end;
$$;

revoke execute on function public.request_post_broadcast(uuid) from public, anon;
grant execute on function public.request_post_broadcast(uuid) to authenticated;
