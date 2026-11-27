-- community-sdk messaging/004_realtime_changed.sql
-- A message hidden by moderation or an admin never reaches other readers through
-- postgres_changes: Realtime checks RLS on the new row, which they can no longer read.
-- This trigger broadcasts `changed` (the message id only) on the conversation's private
-- channel `conversation:<id>`; the client refetches its newest page and the row is gone.
-- No-op where realtime.send doesn't exist. Idempotent.

create or replace function public.messages_broadcast_hidden()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    perform realtime.send(
      jsonb_build_object('id', new.id),
      'changed',
      'conversation:' || new.conversation_id::text,
      true
    );
  end if;
  return null;
end;
$$;

revoke all on function public.messages_broadcast_hidden() from public, anon, authenticated;

drop trigger if exists messages_broadcast_hidden on public.messages;
create trigger messages_broadcast_hidden
  after update of status on public.messages
  for each row
  when (new.status = 'hidden' and old.status is distinct from 'hidden')
  execute function public.messages_broadcast_hidden();
