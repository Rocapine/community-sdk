-- DM pushes (dms/002_push.sql): who claim_message_push picks, and with which kind.
-- Run against a backend with push, messaging, dms/001 and dms/002 applied:
--   npx supabase db query --remote=<ref> --yes -f supabase-tests/dms-push.sql
-- Three existing profiles (a, b, c). The function is called directly; the triggers'
-- calls to notify-message are rolled back with everything else. Every timestamp in one
-- transaction is the same now(), so the test backdates rows where order matters. It
-- always rolls back by raising at the end: the run passed when the error message is
-- exactly DMS_PUSH_TESTS_PASSED.
do $$
declare
  ids uuid[];
  a uuid; b uuid; c uuid;
  ab uuid; ac uuid; bc uuid; g uuid;
  m public.messages;
  r record;
  n int;
  total int;
begin
  select array_agg(id) into ids from (
    select id from public.profiles where not is_banned and not is_admin limit 3
  ) s;
  assert coalesce(array_length(ids, 1), 0) = 3, 'needs three member profiles';
  a := ids[1]; b := ids[2]; c := ids[3];
  delete from public.blocks where blocker_id = any (ids) or blocked_id = any (ids);
  delete from public.conversations where id in (
    select conversation_id from public.dm_pairs where user_a = any (ids) or user_b = any (ids));
  delete from public.dm_declines where sender_id = any (ids) or recipient_id = any (ids);
  delete from public.dm_request_log where sender_id = any (ids) or recipient_id = any (ids);
  update public.profiles set accepts_dms = true where id = any (ids);
  insert into public.push_tokens (user_id) select unnest(ids) on conflict (user_id) do nothing;
  update public.push_tokens set notify_dms = true, notify_group_messages = true
  where user_id = any (ids);

  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"moderation": "post", "ratePerMinute": 1000,
    "dmsFirstMessage": "requests", "dmsRequestsPerDay": 100, "dmsDeclineCooldownDays": 30,
    "dmsRequireAccount": false}');

  -- A new request pushes once, neutral (kind 'request'); its second message doesn't.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ab := public.start_dm(b);
  reset role;
  update public.conversation_members set joined_at = now() - interval '1 hour' where conversation_id = ab;
  assert not exists (select 1 from public.conversation_members where conversation_id = ab and user_id = b),
    'opening the DM gives B nothing';
  set local role authenticated;
  m := public.send_message(ab, 'hello b');
  reset role;
  -- dms/006: B's row comes with the first message, joined just before it.
  assert (select state = 'request' and not notify from public.conversation_members
          where conversation_id = ab and user_id = b), 'B has a request, not followed';
  update public.messages set moderated_at = now() where id = m.id;
  select count(*) filter (where user_id = b and kind = 'request'), count(*) into n, total
  from public.claim_message_push(m.id);
  assert n = 1 and total = 1, 'the request pushes B once, kind request';
  assert not exists (select 1 from public.claim_message_push(m.id)), 'a message is claimed once';

  update public.conversation_members set push_sent_at = now() - interval '5 minutes'
  where conversation_id = ab and user_id = b;
  set local role authenticated;
  m := public.send_message(ab, 'are you there?');
  reset role;
  update public.messages set moderated_at = now() where id = m.id;
  assert not exists (select 1 from public.claim_message_push(m.id)),
    'a later message of the same request pushes nobody';

  -- Accepted: three quick DMs push once (kind 'message'), notify flag ignored.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_request(ab);
  reset role;
  update public.conversation_members set push_sent_at = now() - interval '5 minutes'
  where conversation_id = ab and user_id = b;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  n := 0;
  for i in 1..3 loop
    set local role authenticated;
    m := public.send_message(ab, 'quick ' || i);
    reset role;
    update public.messages set moderated_at = now() where id = m.id;
    for r in select * from public.claim_message_push(m.id) loop
      assert r.user_id = b and r.kind = 'message', 'an accepted DM pushes B, kind message';
      n := n + 1;
    end loop;
  end loop;
  assert n = 1, 'three quick DMs push once, got ' || n;

  -- notify_dms off: nothing; back on: the next one pushes again.
  update public.conversation_members set push_sent_at = now() - interval '5 minutes'
  where conversation_id = ab and user_id = b;
  update public.push_tokens set notify_dms = false where user_id = b;
  set local role authenticated;
  m := public.send_message(ab, 'switch off');
  reset role;
  update public.messages set moderated_at = now() where id = m.id;
  assert not exists (select 1 from public.claim_message_push(m.id)), 'notify_dms off pushes nobody';
  update public.push_tokens set notify_dms = true where user_id = b;
  update public.push_tokens set notify_group_messages = false where user_id = b;
  set local role authenticated;
  m := public.send_message(ab, 'switch on');
  reset role;
  update public.messages set moderated_at = now() where id = m.id;
  assert (select count(*) from public.claim_message_push(m.id)) = 1,
    'the group switch doesn''t touch DMs';
  update public.push_tokens set notify_group_messages = true where user_id = b;

  -- Declined: the sender's messages push nobody; after the cooldown, the new request
  -- pushes once.
  set local role authenticated;
  ac := public.start_dm(c);
  reset role;
  update public.conversation_members set joined_at = now() - interval '1 hour' where conversation_id = ac;
  set local role authenticated;
  m := public.send_message(ac, 'hello c');
  reset role;
  update public.messages set moderated_at = now() where id = m.id;
  assert (select count(*) from public.claim_message_push(m.id) where kind = 'request') = 1,
    'C gets the request push';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.decline_request(ac);
  reset role;
  update public.conversation_members set push_sent_at = now() - interval '1 hour'
  where conversation_id = ac and user_id = c;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  m := public.send_message(ac, 'still there?');
  reset role;
  update public.messages set moderated_at = now() where id = m.id;
  assert not exists (select 1 from public.claim_message_push(m.id)), 'a declined request pushes nobody';

  update public.dm_declines set until = now() - interval '1 minute' where sender_id = a and recipient_id = c;
  set local role authenticated;
  m := public.send_message(ac, 'a month later');
  reset role;
  update public.messages set moderated_at = now() where id = m.id;
  assert (select state = 'request' from public.conversation_members
          where conversation_id = ac and user_id = c), 'a new request after the cooldown';
  select count(*) filter (where user_id = c and kind = 'request'), count(*) into n, total
  from public.claim_message_push(m.id);
  assert n = 1 and total = 1, 'the new request pushes C once, kind request';
  set local role authenticated;
  m := public.send_message(ac, 'and again');
  reset role;
  update public.messages set moderated_at = now() where id = m.id;
  assert not exists (select 1 from public.claim_message_push(m.id)), 'its next message doesn''t';

  -- A block: nothing.
  insert into public.blocks (blocker_id, blocked_id) values (b, a);
  update public.conversation_members set push_sent_at = null where conversation_id = ab;
  insert into public.messages (conversation_id, author_id, body, status, moderated_at)
  values (ab, a, 'blocked', 'visible', now()) returning * into m;
  assert not exists (select 1 from public.claim_message_push(m.id)), 'a block pushes nobody';
  delete from public.blocks where blocker_id = b and blocked_id = a;

  -- Groups keep messaging/002's rules: followers only (notify), kind 'message'.
  insert into public.conversations (kind) values ('group') returning id into g;
  insert into public.conversation_members (conversation_id, user_id, notify, joined_at) values
    (g, a, true, now() - interval '1 hour'),
    (g, b, true, now() - interval '1 hour'),
    (g, c, false, now() - interval '1 hour');
  insert into public.messages (conversation_id, author_id, body, status, moderated_at)
  values (g, a, 'group hi', 'visible', now()) returning * into m;
  n := 0;
  for r in select * from public.claim_message_push(m.id) loop
    assert r.user_id = b and r.kind = 'message', 'only B follows the group';
    n := n + 1;
  end loop;
  assert n = 1, 'one group push, got ' || n;
  update public.push_tokens set notify_group_messages = false where user_id = b;
  update public.conversation_members set push_sent_at = null where conversation_id = g;
  insert into public.messages (conversation_id, author_id, body, status, moderated_at)
  values (g, a, 'group again', 'visible', now()) returning * into m;
  assert not exists (select 1 from public.claim_message_push(m.id)), 'the group switch still applies';

  -- dms/006: in direct mode the first message pushes its recipient, whose row it made.
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"dmsFirstMessage": "direct"}');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  bc := public.start_dm(c);
  m := public.send_message(bc, 'direct hi');
  reset role;
  update public.messages set moderated_at = now() where id = m.id;
  select count(*) filter (where user_id = c and kind = 'message'), count(*) into n, total
  from public.claim_message_push(m.id);
  assert n = 1 and total = 1, 'the first direct message pushes C, kind message';

  raise exception 'DMS_PUSH_TESTS_PASSED';
end $$;
