-- community-sdk dms/002_push.sql
-- DM pushes (notify-message) and the member-wide DM switch.
--
-- claim_message_push is messaging/002's, plus DMs, and returns a `kind` per recipient:
--  - Groups: unchanged (active, following the group, notify_group_messages on, the 60 s
--    throttle).
--  - DMs: the other member is always a follower (their `notify` flag is ignored) unless
--    push_tokens.notify_dms is off; never a declined row, nor a message before their
--    visible_from. An accepted DM throttles like a group (kind 'message'). A request
--    pushes once, on its first message (kind 'request', the neutral push): it pushes
--    while the recipient was never pushed for it (push_sent_at null, or before the
--    visible_from a request after the cooldown sets); later messages of the request
--    push nothing.
-- Both: never the author, never across a block, only an unread message, and the message
-- is claimed first (pushed_at), so it pushes at most once.
--
-- The badge needs nothing here: unread_followed_messages_for (messaging/002) runs
-- unread_followed_messages, which dms/001 made count DMs and pending requests.
--
-- Needs the push module (push_tokens). A host that adds `push` after `dms` re-runs
-- messaging/002_push.sql, then this file. Re-running messaging/002 alone after this file
-- fails on claim_message_push's return type: run this file again after it.
-- Requires dms/001. Idempotent.

do $do$
begin
  if to_regclass('public.push_tokens') is null then
    raise notice 'community-sdk: push module not installed, DM pushes skipped';
    return;
  end if;

  -- Member-wide switch for DM pushes, next to notify_group_messages.
  alter table public.push_tokens
    add column if not exists notify_dms boolean not null default true;

  -- The return type gains `kind`, which create or replace can't change.
  if to_regprocedure('public.claim_message_push(uuid)') is not null
     and pg_get_function_result('public.claim_message_push(uuid)'::regprocedure)
         not like '%kind text%' then
    drop function public.claim_message_push(uuid);
  end if;
  create or replace function public.claim_message_push(p_message uuid)
  returns table (user_id uuid, locale text, kind text)
  language sql volatile security definer set search_path = public
  as $fn$
    with m as (
      update messages set pushed_at = now()
      where id = p_message and pushed_at is null
        and status = 'visible' and moderated_at is not null
      returning id, conversation_id, author_id, created_at
    ), mc as (
      select m.*, c.kind = 'dm' as is_dm
      from m join conversations c on c.id = m.conversation_id
    ), claimed as (
      update conversation_members cm set push_sent_at = now()
      from mc
      where cm.conversation_id = mc.conversation_id and cm.user_id <> mc.author_id
        and mc.created_at > coalesce(cm.last_read_at, cm.joined_at)
        and not exists (
          select 1 from blocks b
          where (b.blocker_id = cm.user_id and b.blocked_id = mc.author_id)
             or (b.blocker_id = mc.author_id and b.blocked_id = cm.user_id))
        and (
          -- A group: messaging/002's rules.
          (not mc.is_dm and cm.state = 'active' and cm.notify
           and (cm.push_sent_at is null
                or cm.push_sent_at < now() - interval '60 seconds'
                or cm.last_read_at >= cm.push_sent_at)
           and coalesce((select pt.notify_group_messages from push_tokens pt
                         where pt.user_id = cm.user_id), true))
          or
          -- A DM: always followed, never what the recipient may not read.
          (mc.is_dm
           and mc.created_at >= coalesce(cm.visible_from, '-infinity')
           and coalesce((select pt.notify_dms from push_tokens pt
                         where pt.user_id = cm.user_id), true)
           and ((cm.state = 'active'
                 and (cm.push_sent_at is null
                      or cm.push_sent_at < now() - interval '60 seconds'
                      or cm.last_read_at >= cm.push_sent_at))
                or (cm.state = 'request'
                    and (cm.push_sent_at is null or cm.push_sent_at < cm.visible_from))))
        )
      returning cm.user_id,
        case when mc.is_dm and cm.state = 'request' then 'request' else 'message' end as kind
    )
    select c.user_id, p.locale, c.kind from claimed c left join profiles p on p.id = c.user_id;
  $fn$;
  revoke execute on function public.claim_message_push(uuid) from public, anon, authenticated;
  grant execute on function public.claim_message_push(uuid) to service_role;
end;
$do$;
