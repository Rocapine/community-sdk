-- community-sdk dms/004_block_broadcast.sql
-- A block (or an unblock) between two members who share a DM broadcasts `members` (no
-- payload beyond the conversation id) on that DM's private channel `conversation:<id>`,
-- like groups/004: an open DM screen refetches the conversation list and closes (or
-- reopens) its composer at once, on both sides. Realtime checks a private channel's
-- policies when it is joined, so the members still joined get it after the block.
-- No-op where realtime.send doesn't exist. Requires dms/001. Idempotent.

create or replace function public.dms_broadcast_block()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.blocks := coalesce(new, old);
  v_conversation uuid;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return null;
  end if;
  select d.conversation_id into v_conversation
  from public.dm_pairs d
  where d.user_a = least(v_row.blocker_id, v_row.blocked_id)
    and d.user_b = greatest(v_row.blocker_id, v_row.blocked_id);
  if v_conversation is not null then
    perform realtime.send(
      jsonb_build_object('id', v_conversation),
      'members',
      'conversation:' || v_conversation::text,
      true
    );
  end if;
  return null;
end;
$$;

revoke all on function public.dms_broadcast_block() from public, anon, authenticated;

drop trigger if exists dms_broadcast_block on public.blocks;
create trigger dms_broadcast_block
  after insert or delete on public.blocks
  for each row
  execute function public.dms_broadcast_block();
