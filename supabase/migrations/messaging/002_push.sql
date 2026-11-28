-- community-sdk messaging/002_push.sql
-- Group message pushes (notify-message) and followed messages in the app-icon badge.
--
-- unread_followed_messages_for(uid): the service role's view of a member's
-- unread_followed_messages(), added to the badge every notify-* function sends.
-- The rest needs the push module (push_tokens), installed before messaging. A host
-- that adds `push` after `messaging` must re-run this file once push is in: until
-- then there is no trigger, no claim function and no notify_group_messages switch.
-- Idempotent.

-- Runs unread_followed_messages() as p_uid, so the count can't drift from the app's.
create or replace function public.unread_followed_messages_for(p_uid uuid)
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_count int;
begin
  -- auth.uid() reads either setting, depending on the PostgREST version. Both are
  -- put back afterwards, so the rest of the caller's transaction keeps its identity.
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid)::text, true);
  v_count := public.unread_followed_messages();
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_count;
end;
$$;
revoke execute on function public.unread_followed_messages_for(uuid) from public, anon, authenticated;
grant execute on function public.unread_followed_messages_for(uuid) to service_role;

-- When the last push to a member for a conversation left (the 60 s throttle).
alter table public.conversation_members add column if not exists push_sent_at timestamptz;
-- When a message was pushed (or found nobody to push): a message pushes once, so an
-- edit sent back through moderation after that never pushes again.
alter table public.messages add column if not exists pushed_at timestamptz;

do $do$
begin
  if to_regclass('public.push_tokens') is null then
    raise notice 'community-sdk: push module not installed, group message pushes skipped';
    return;
  end if;

  -- Member-wide switch for group message pushes, next to notify_likes / notify_comments.
  alter table public.push_tokens
    add column if not exists notify_group_messages boolean not null default true;

  -- The members a ready message pushes to, with their locale, stamped in the same
  -- statement so parallel calls push each member once: active, following the group,
  -- not the author, not blocked either way, the member-wide switch on, the message
  -- still unread, and no push in the last 60 s unless they read the conversation
  -- since. The message is claimed first (pushed_at): a second call for it gets nobody.
  -- An earlier draft returned setof uuid, which create or replace can't change.
  if to_regprocedure('public.claim_message_push(uuid)') is not null
     and pg_get_function_result('public.claim_message_push(uuid)'::regprocedure) = 'SETOF uuid' then
    drop function public.claim_message_push(uuid);
  end if;
  create or replace function public.claim_message_push(p_message uuid)
  returns table (user_id uuid, locale text)
  language sql volatile security definer set search_path = public
  as $fn$
    with m as (
      update messages set pushed_at = now()
      where id = p_message and pushed_at is null
        and status = 'visible' and moderated_at is not null
      returning id, conversation_id, author_id, created_at
    ), claimed as (
      update conversation_members cm set push_sent_at = now()
      from m
      where cm.conversation_id = m.conversation_id and cm.state = 'active' and cm.notify
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
      returning cm.user_id
    )
    select c.user_id, p.locale from claimed c left join profiles p on p.id = c.user_id;
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
  -- through moderation again; pushed_at (claim_message_push) keeps that from pushing
  -- twice, and a message edited before its first push still pushes once.
  create or replace trigger on_message_ready_insert
    after insert on public.messages
    for each row
    when (new.status = 'visible' and new.moderated_at is not null)
    execute function public.notify_message_webhook();

  create or replace trigger on_message_ready
    after update of status, moderated_at on public.messages
    for each row
    when (new.status = 'visible' and new.moderated_at is not null
          and old.moderated_at is null)
    execute function public.notify_message_webhook();
end;
$do$;
