-- community-sdk groups/004_members_changed.sql
-- A join, a leave or a removal changes the group's member_count (group_recount_members).
-- This trigger then broadcasts `members` (no payload beyond the group id) on the
-- conversation's private channel `conversation:<id>`: open chats refetch the group, so
-- the header's member count stays current and a member just removed sees the removed
-- line at once. Realtime checks a private channel's policies when it is joined, so the
-- removed member, still joined, gets this broadcast too.
-- No-op where realtime.send doesn't exist. Idempotent.

create or replace function public.groups_broadcast_members()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    perform realtime.send(
      jsonb_build_object('id', new.conversation_id),
      'members',
      'conversation:' || new.conversation_id::text,
      true
    );
  end if;
  return null;
end;
$$;

revoke all on function public.groups_broadcast_members() from public, anon, authenticated;

drop trigger if exists groups_broadcast_members on public.groups;
create trigger groups_broadcast_members
  after update of member_count on public.groups
  for each row
  when (new.member_count is distinct from old.member_count)
  execute function public.groups_broadcast_members();
