-- community-sdk core/012_pin_posts.sql (schema v1)
-- Admins pin and unpin posts from the app. `pinned_at` stays out of the client's
-- column grants; this function is the only client path to it. A pinned post leads
-- its feeds (newest pin first) until unpinned.

create or replace function public.set_post_pinned(p_post_id uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.current_user_admin() then
    raise exception 'only admins pin posts' using errcode = '42501';
  end if;
  update posts set pinned_at = case when p_pinned then now() end where id = p_post_id;
end;
$$;

revoke execute on function public.set_post_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_post_pinned(uuid, boolean) to authenticated;
