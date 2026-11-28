-- community-sdk dms/003_flags_search_read.sql
-- Review fixes on dms/001:
-- - profile_dm_flags leaves banned members out and says whether the caller already has
--   a DM with each member (`has_dm`: that DM opens whatever the switch says). Its row
--   type changes, so it is dropped and created again.
-- - search_dm_members: the "new message" picker, members the caller may start a DM with.
-- - mark_conversation_read (messaging/001's) broadcasts `read` on the conversation's
--   private channel when a DM member with read receipts on reads a new message of the
--   peer's, so the peer's "Seen" updates live. A member could send one too (messaging/001's
--   send policy admits any event): it only makes the peer refetch dm_peer_read.
-- Requires messaging/001 and dms/001. Idempotent.

drop function if exists public.profile_dm_flags(uuid[]);
create function public.profile_dm_flags(p_ids uuid[])
returns table (user_id uuid, accepts_dms boolean, has_account boolean, has_dm boolean)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids)
  select p.id, p.accepts_dms, public.has_account_link(p.id),
    exists (select 1 from dm_pairs d
            where d.user_a = least(p.id, auth.uid()) and d.user_b = greatest(p.id, auth.uid()))
  from profiles p
  cross join b
  where auth.uid() is not null
    and p.id = any ((p_ids)[1:200])
    and not p.is_banned
    and not (p.id = any (b.ids));
$$;

-- Members whose username contains p_query (a literal: % and _ match themselves) the
-- caller may start a DM with: not the caller, not banned, no block either way, and an
-- existing DM or, for a new one, the switch on and the account rule met. Up to 50.
create or replace function public.search_dm_members(p_query text, p_limit int default 20)
returns table (user_id uuid, username text, avatar_url text)
language sql stable security definer set search_path = public
as $$
  with b as (select public.blocked_member_ids() as ids),
  q as (select replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') as s),
  acct as (select coalesce((public.messaging_setting('dmsRequireAccount'))::boolean, false) as required)
  select p.id, p.username, p.avatar_url
  from profiles p
  cross join b
  cross join q
  cross join acct
  where auth.uid() is not null
    and q.s <> ''
    and p.id <> auth.uid()
    and not p.is_banned
    and not (p.id = any (b.ids))
    and p.username ilike '%' || q.s || '%'
    and (exists (select 1 from dm_pairs d
                 where d.user_a = least(p.id, auth.uid()) and d.user_b = greatest(p.id, auth.uid()))
         or (p.accepts_dms
             and (not acct.required
                  or (public.has_account_link(p.id) and public.has_account_link(auth.uid())))))
  order by p.username, p.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- messaging/001's, plus the `read` broadcast: only in a DM with read receipts on, when
-- this read took in a message of the peer's not read before, and with dm_peer_read's
-- checks from the peer's side (both active, no block either way, nothing the reader
-- declined counted), so the peer's "Seen" refetches only when it can change.
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_me public.conversation_members;
begin
  select * into v_me from conversation_members
  where conversation_id = p_conversation and user_id = auth.uid() and state = 'active';
  if not found then
    return;
  end if;
  update conversation_members set last_read_at = now()
  where conversation_id = p_conversation and user_id = auth.uid() and state = 'active';
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null
     and coalesce((public.messaging_setting('dmsReadReceipts'))::boolean, false)
     and exists (select 1 from conversations where id = p_conversation and kind = 'dm')
     and exists (
       select 1 from conversation_members o
       join messages m on m.conversation_id = o.conversation_id and m.author_id = o.user_id
       where o.conversation_id = p_conversation and o.user_id <> auth.uid()
         and o.state = 'active'
         and not (o.user_id = any (public.blocked_member_ids()))
         and m.status = 'visible'
         and m.created_at > coalesce(v_me.last_read_at, '-infinity')
         and m.created_at >= coalesce(v_me.visible_from, '-infinity')
     ) then
    perform realtime.send(
      jsonb_build_object('id', p_conversation),
      'read',
      'conversation:' || p_conversation::text,
      true
    );
  end if;
end;
$$;

revoke execute on function public.profile_dm_flags(uuid[]) from public, anon;
revoke execute on function public.search_dm_members(text, int) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.profile_dm_flags(uuid[]) to authenticated;
grant execute on function public.search_dm_members(text, int) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
