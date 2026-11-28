-- community-sdk groups/007_online_others.sql (schema v1)
-- group_online_counts (groups/001) counts the OTHER members online: "3 online" in a
-- group's header, its card or Explore never counts the reader. Same signature, grants
-- kept. Requires groups/001. Idempotent.

create or replace function public.group_online_counts(p_groups uuid[])
returns table (group_id uuid, online int)
language plpgsql stable security definer set search_path = public
as $$
begin
  if to_regclass('public.member_presence') is null then
    return query select gid, 0 from unnest(p_groups[1:100]) gid;
    return;
  end if;
  return query
  select gid, (
    select count(*)::int
    from conversation_members cm
    join member_presence mp on mp.user_id = cm.user_id
    join profiles p on p.id = cm.user_id
    where cm.conversation_id = gid and cm.state = 'active'
      and cm.user_id is distinct from auth.uid()
      and mp.visible and not p.is_banned
      and mp.last_active_at > now() - make_interval(
        mins => coalesce((select grace_minutes from presence_settings), 5))
      and not (cm.user_id = any (public.blocked_member_ids()))
  )
  from unnest(p_groups[1:100]) gid
  where public.can_read_conversation(gid);
end;
$$;
