-- community-sdk messaging/002_push.sql
-- Group message pushes (notify-message) and followed messages in the app-icon badge.
--
-- unread_followed_messages_for(uid): the service role's view of a member's
-- unread_followed_messages(), added to the badge every notify-* function sends.
-- The rest needs the push module (push_tokens), installed before messaging; a host
-- that adds push later re-runs this file. Idempotent.

-- Runs unread_followed_messages() as p_uid, so the count can't drift from the app's.
create or replace function public.unread_followed_messages_for(p_uid uuid)
returns int
language plpgsql volatile security definer set search_path = public
as $$
begin
  -- auth.uid() reads either setting, depending on the PostgREST version. Local to
  -- this transaction (the RPC call), which ends here.
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid)::text, true);
  return public.unread_followed_messages();
end;
$$;
revoke execute on function public.unread_followed_messages_for(uuid) from public, anon, authenticated;
grant execute on function public.unread_followed_messages_for(uuid) to service_role;

-- When the last push to a member for a conversation left (the 60 s throttle).
alter table public.conversation_members add column if not exists push_sent_at timestamptz;

do $do$
begin
  if to_regclass('public.push_tokens') is null then
    raise notice 'community-sdk: push module not installed, group message pushes skipped';
    return;
  end if;

  -- Member-wide switch for group message pushes, next to notify_likes / notify_comments.
  alter table public.push_tokens
    add column if not exists notify_group_messages boolean not null default true;

  -- The members a ready message pushes to, stamped in the same statement so parallel
  -- calls for quick messages push each member once: active, following the group, not
  -- the author, not blocked either way, the member-wide switch on, the message still
  -- unread, and no push in the last 60 s unless they read the conversation since.
  create or replace function public.claim_message_push(p_message uuid)
  returns setof uuid
  language sql volatile security definer set search_path = public
  as $fn$
    update conversation_members cm set push_sent_at = now()
    from messages m
    where m.id = p_message and m.status = 'visible' and m.moderated_at is not null
      and cm.conversation_id = m.conversation_id and cm.state = 'active' and cm.notify
      and cm.user_id <> m.author_id
      and m.created_at > coalesce(cm.last_read_at, cm.joined_at)
      and (cm.push_sent_at is null
           or cm.push_sent_at < now() - interval '60 seconds'
           or cm.last_read_at >= cm.push_sent_at)
      and not exists (
        select 1 from blocks b
        where (b.blocker_id = cm.user_id and b.blocked_id = m.author_id)
           or (b.blocker_id = m.author_id and b.blocked_id = cm.user_id))
      and coalesce((select pt.notify_group_messages from push_tokens pt
                    where pt.user_id = cm.user_id), true)
    returning cm.user_id;
  $fn$;
  revoke execute on function public.claim_message_push(uuid) from public, anon, authenticated;
  grant execute on function public.claim_message_push(uuid) to service_role;

  create or replace function public.notify_message_webhook()
  returns trigger language plpgsql security definer set search_path = public as $fn$
  begin
    -- The id only: notify-message re-reads the message.
    perform public.community_call_function('notify-message',
      jsonb_build_object('record', jsonb_build_object('id', new.id)));
    return new;
  end; $fn$;
  revoke execute on function public.notify_message_webhook() from public, anon, authenticated;

  -- A message pushes once it is ready (visible and seen by the AI): inserted ready
  -- (reportOnly), or stamped by moderation (post: visible then stamped; pre/image:
  -- pending to visible and stamped). Hidden never pushes. An edit sends the message
  -- through moderation again: edited_at keeps that from pushing twice.
  create or replace trigger on_message_ready_insert
    after insert on public.messages
    for each row
    when (new.status = 'visible' and new.moderated_at is not null)
    execute function public.notify_message_webhook();

  create or replace trigger on_message_ready
    after update of status, moderated_at on public.messages
    for each row
    when (new.status = 'visible' and new.moderated_at is not null
          and old.moderated_at is null and new.edited_at is null)
    execute function public.notify_message_webhook();
end;
$do$;
