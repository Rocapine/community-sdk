-- Direct messages (dms/001_dms.sql) on the messaging core.
-- Run against a backend with messaging and dms applied (groups optional):
--   npx supabase db query --remote=<ref> --yes -f supabase-tests/dms.sql
-- Five existing profiles (a, b, c, x, a2) write DMs to each other. Every timestamp
-- in one transaction is the same now(), so the test backdates rows where order
-- matters. It always rolls back by raising at the end: the run passed when the error
-- message is exactly DMS_TESTS_PASSED.
do $$
declare
  ids uuid[];
  a uuid; b uuid; c uuid; x uuid; a2 uuid;
  ab uuid; ac uuid; cx uuid; a2c uuid; a2x uuid; a2b uuid; g uuid;
  m public.messages;
  m_ab public.messages;
  r record;
  n0 int;
  n int;
begin
  select array_agg(id) into ids from (
    select id from public.profiles where not is_banned and not is_admin limit 5
  ) s;
  assert coalesce(array_length(ids, 1), 0) = 5, 'needs five member profiles';
  a := ids[1]; b := ids[2]; c := ids[3]; x := ids[4]; a2 := ids[5];
  delete from public.blocks where blocker_id = any (ids) or blocked_id = any (ids);
  delete from public.conversations where id in (
    select conversation_id from public.dm_pairs where user_a = any (ids) or user_b = any (ids));
  delete from public.dm_declines where sender_id = any (ids) or recipient_id = any (ids);
  delete from public.dm_request_log where sender_id = any (ids) or recipient_id = any (ids);
  update public.profiles set accepts_dms = true where id = any (ids);
  if to_regclass('public.account_links') is not null then
    delete from public.account_links where profile_id = any (ids);
  end if;

  -- Settings: the DM keys are validated like the others.
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"moderation": "post", "ratePerMinute": 1000,
    "onAccountDelete": "keep", "dmsFirstMessage": "requests", "dmsReadReceipts": true,
    "dmsRequireAccount": false, "dmsRequestsPerDay": 100, "dmsDeclineCooldownDays": 0}');
  perform public.messaging_set_settings('{"dmsDeclineCooldownDays": 30}');
  begin
    perform public.messaging_set_settings('{"dmsFirstMessage": "later"}');
    assert false, 'an unknown first-message mode is refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_setting:dmsFirstMessage', 'got ' || sqlerrm;
  end;
  begin
    perform public.messaging_set_settings('{"dmsRequestsPerDay": 0}');
    assert false, 'zero requests a day is refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_setting:dmsRequestsPerDay', 'got ' || sqlerrm;
  end;
  begin
    perform public.messaging_set_settings('{"dmsReadReceipts": "yes"}');
    assert false, 'a non-boolean switch is refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_setting:dmsReadReceipts', 'got ' || sqlerrm;
  end;
  assert public.messaging_client_settings() ->> 'dmsFirstMessage' = 'requests'
    and (public.messaging_client_settings() ->> 'dmsDeclineCooldownDays')::int = 30,
    'the client settings carry the DM keys';

  -- B's followed unread count before any DM (B may have other conversations).
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n0 := public.unread_followed_messages();
  reset role;

  -- Requests: A writes to B; B reads it without leaving a read state.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ab := public.start_dm(b);
  m_ab := public.send_message(ab, 'hi b');
  assert public.start_dm(b) = ab, 'one DM per pair';
  begin
    perform public.start_dm(a);
    assert false, 'no DM with oneself';
  exception when raise_exception then
    assert sqlerrm = 'invalid_recipient', 'got ' || sqlerrm;
  end;
  assert (select count(*) from public.conversation_members where conversation_id = ab) = 1,
    'the sender reads only their own row';
  reset role;
  assert (select state from public.conversation_members where conversation_id = ab and user_id = a) = 'active'
    and (select state from public.conversation_members where conversation_id = ab and user_id = b) = 'request',
    'requests: sender active, recipient in request';
  update public.conversation_members set joined_at = now() - interval '1 hour' where conversation_id = ab;
  update public.messages set created_at = now() - interval '50 minutes' where id = m_ab.id;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.messages where conversation_id = ab) = 1, 'the recipient reads the request';
  perform public.mark_conversation_read(ab);
  select * into r from public.list_dm_requests() l where l.conversation_id = ab;
  assert r.sender_id = a and r.last_body = 'hi b' and not r.last_has_image
    and r.groups_in_common >= 0 and r.member_since is not null, 'listed as a request';
  assert exists (select 1 from public.dm_peers() p where p.conversation_id = ab and p.peer_id = a and p.my_state = 'request'),
    'dm_peers names the sender';
  assert not exists (select 1 from public.list_conversations() l where l.conversation_id = ab),
    'a request is not in the conversation list';
  assert public.unread_followed_messages() = n0 + 1, 'a pending request counts one';
  begin
    perform public.send_message(ab, 'reply');
    assert false, 'the recipient accepts before writing';
  exception when raise_exception then
    assert sqlerrm = 'not_a_member', 'got ' || sqlerrm;
  end;
  reset role;
  assert (select last_read_at from public.conversation_members where conversation_id = ab and user_id = b) is null,
    'reading a request leaves no read state';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.dm_peer_read(ab) is null, 'no receipt on a request';
  reset role;

  -- Mutual start: B starting a DM with A accepts A's pending request.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.start_dm(a) = ab, 'one conversation';
  assert public.unread_followed_messages() = n0 + 1, 'an active DM counts its unread, notify off';
  perform public.mark_conversation_read(ab);
  assert public.unread_followed_messages() = n0, 'read';
  reset role;
  assert (select count(*) from public.conversation_members where conversation_id = ab and state = 'active') = 2,
    'both active';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.dm_peer_read(ab) is not null, 'read receipts once both are active';
  reset role;
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"dmsReadReceipts": false}');
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.dm_peer_read(ab) is null, 'no receipts when off';
  reset role;

  -- Decline: silent for A; C never sees the declined request again.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ac := public.start_dm(c);
  perform public.send_message(ac, 'before decline');
  reset role;
  update public.conversation_members set joined_at = now() - interval '1 hour' where conversation_id = ac;
  update public.messages set created_at = now() - interval '40 minutes' where conversation_id = ac;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.decline_request(ac);
  begin
    perform public.decline_request(ac);
    assert false, 'only a pending request is declined';
  exception when raise_exception then
    assert sqlerrm = 'not_found', 'got ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.start_dm(c) = ac, 'the sender is never told';
  perform public.send_message(ac, 'during cooldown 1');
  perform public.send_message(ac, 'during cooldown 2');
  assert (select count(*) from public.messages where conversation_id = ac) = 3, 'the sender sees all they wrote';
  reset role;
  update public.messages set created_at = now() - interval '30 minutes'
  where conversation_id = ac and body like 'during%';
  assert (select state from public.conversation_members where conversation_id = ac and user_id = c) = 'declined',
    'declined';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.messages where conversation_id = ac) = 0, 'nothing of a declined request';
  assert not public.can_read_conversation(ac), 'not readable';
  assert not exists (select 1 from public.list_dm_requests() l where l.conversation_id = ac), 'not a request';
  assert not exists (select 1 from public.dm_peers() p where p.conversation_id = ac), 'not a peer';
  reset role;

  -- Cooldown over: A's next message starts a new request showing only itself.
  update public.dm_declines set until = now() - interval '1 minute' where sender_id = a and recipient_id = c;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.send_message(ac, 'after cooldown');
  reset role;
  assert (select state from public.conversation_members where conversation_id = ac and user_id = c) = 'request',
    'a new request';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.messages where conversation_id = ac) = 1
    and (select body from public.messages where conversation_id = ac) = 'after cooldown', 'only the new message';
  select * into r from public.list_dm_requests() l where l.conversation_id = ac;
  assert r.last_body = 'after cooldown', 'listed with the new message';
  perform public.accept_request(ac);
  select * into r from public.list_conversations() l where l.conversation_id = ac;
  assert r.last_body = 'after cooldown' and r.unread = 1, 'accepted: the declined messages stay out';
  assert (select count(*) from public.messages where conversation_id = ac) = 1, 'and unread';
  reset role;
  if to_regclass('public.notifications') is not null then
    assert exists (select 1 from public.notifications
                   where user_id = a and kind = 'dm_request_accepted' and actor_id = c),
      'the sender learns of the acceptance';
  end if;

  -- The decliner writing back later doesn't see what they declined.
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  a2c := public.start_dm(c);
  perform public.send_message(a2c, 'declined text');
  reset role;
  update public.messages set created_at = now() - interval '20 minutes' where conversation_id = a2c;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.decline_request(a2c);
  assert public.start_dm(a2) = a2c, 'the decliner can write later';
  assert (select count(*) from public.messages where conversation_id = a2c) = 0, 'without the declined messages';
  select * into r from public.list_conversations() l where l.conversation_id = a2c;
  assert r.last_body is null and r.unread = 0 and r.last_message_at is null, 'not even in the list';
  reset role;

  -- Blocks: no request, no write either way, nothing listed; outsiders read nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cx := public.start_dm(x);
  perform public.send_message(cx, 'to x');
  reset role;
  insert into public.blocks (blocker_id, blocked_id) values (x, c);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert not exists (select 1 from public.list_dm_requests() l where l.conversation_id = cx), 'no request from a blocked member';
  assert not exists (select 1 from public.dm_peers() p where p.conversation_id = cx), 'no peer';
  assert not public.can_read_conversation(cx)
    and (select count(*) from public.messages where conversation_id = cx) = 0, 'nothing readable';
  assert not exists (select 1 from public.profile_dm_flags(array[c])), 'no flags for a blocked member';
  begin
    perform public.start_dm(c);
    assert false, 'no DM across a block';
  exception when raise_exception then
    assert sqlerrm = 'blocked', 'got ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.send_message(cx, 'still there?');
    assert false, 'the blocked sender cannot write';
  exception when raise_exception then
    assert sqlerrm = 'blocked', 'got ' || sqlerrm;
  end;
  reset role;
  insert into public.blocks (blocker_id, blocked_id) values (a, b);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.send_message(ab, 'blocked?');
    assert false, 'the blocker cannot write';
  exception when raise_exception then
    assert sqlerrm = 'blocked', 'got ' || sqlerrm;
  end;
  assert not exists (select 1 from public.dm_peers() p where p.conversation_id = ab), 'blocked pair out of dm_peers';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.send_message(ab, 'blocked?');
    assert false, 'the blocked member cannot write';
  exception when raise_exception then
    assert sqlerrm = 'blocked', 'got ' || sqlerrm;
  end;
  assert (select count(*) from public.messages where conversation_id = ab) = 0, 'nor read';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert not public.can_read_conversation(ab)
    and (select count(*) from public.messages where conversation_id = ab) = 0
    and (select count(*) from public.conversations where id = ab) = 0, 'an outsider reads nothing';
  reset role;
  delete from public.blocks where blocker_id = any (ids) or blocked_id = any (ids);

  -- accepts_dms off: no new DM, existing ones keep working.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_accepts_dms(false);
  reset role;
  assert not (select accepts_dms from public.profiles where id = b), 'switched off';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from public.profile_dm_flags(array[b, c]) f where f.user_id = b;
  assert not r.accepts_dms and r.has_account is not null, 'flags say B refuses DMs';
  begin
    perform public.start_dm(b);
    assert false, 'B refuses new DMs';
  exception when raise_exception then
    assert sqlerrm = 'dms_off', 'got ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.send_message(ab, 'existing DMs keep working');
  assert public.start_dm(b) = ab, 'and open';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_accepts_dms(true);
  reset role;

  -- requestsPerDay, then the cooldown on a new DM.
  select count(*) into n from public.dm_request_log where sender_id = a and at > now() - interval '1 day';
  assert n >= 2, 'A''s requests are logged';
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings(jsonb_build_object('dmsRequestsPerDay', n));
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_dm(x);
    assert false, 'one request too many';
  exception when raise_exception then
    assert sqlerrm = 'too_many_requests', 'got ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"dmsRequestsPerDay": 100}');
  insert into public.dm_declines (sender_id, recipient_id, until) values (x, a, now() + interval '1 day');
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_dm(a);
    assert false, 'A declined X recently';
  exception when raise_exception then
    assert sqlerrm = 'declined_recently', 'got ' || sqlerrm;
  end;
  reset role;

  -- Account rule, where the accounts module is installed: both sides need a link.
  if to_regclass('public.account_links') is not null then
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    perform public.messaging_set_settings('{"dmsRequireAccount": true}');
    perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.start_dm(b);
      assert false, 'the sender needs an account';
    exception when raise_exception then
      assert sqlerrm = 'account_required', 'got ' || sqlerrm;
    end;
    reset role;
    insert into public.account_links (provider, subject, profile_id) values ('test', 'dms-x', x);
    perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.start_dm(b);
      assert false, 'the recipient needs one too';
    exception when raise_exception then
      assert sqlerrm = 'account_required', 'got ' || sqlerrm;
    end;
    reset role;
    insert into public.account_links (provider, subject, profile_id) values ('test', 'dms-b', b);
    perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    set local role authenticated;
    assert public.start_dm(b) is not null, 'both linked';
    reset role;
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    perform public.messaging_set_settings('{"dmsRequireAccount": false}');
  end if;

  -- Block and report a request; the dashboard reads a reported DM message only.
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  a2x := public.start_dm(x);
  m := public.send_message(a2x, 'spam here');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.block_and_report_request(a2x, 'nonsense');
    assert false, 'an unknown reason is refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_reason', 'got ' || sqlerrm;
  end;
  perform public.block_and_report_request(a2x, 'spam');
  reset role;
  assert exists (select 1 from public.blocks where blocker_id = x and blocked_id = a2), 'blocked';
  assert exists (select 1 from public.reports where reporter_id = x and reported_user_id = a2 and message_id = m.id),
    'the request''s latest message is reported';
  assert (select state from public.conversation_members where conversation_id = a2x and user_id = x) = 'declined',
    'and declined';
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  assert (select count(*) from public.admin_message_context(m.id)) >= 1, 'a reported DM message has context';
  begin
    perform public.admin_message_context(m_ab.id);
    assert false, 'an unreported DM message has none';
  exception when raise_exception then
    assert sqlerrm = 'forbidden', 'got ' || sqlerrm;
  end;
  delete from public.blocks where blocker_id = any (ids) or blocked_id = any (ids);

  -- eraseDms: A's DM messages go, their group messages stay.
  insert into public.conversations (kind) values ('group') returning id into g;
  insert into public.conversation_members (conversation_id, user_id) values (g, a);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.send_message(g, 'group message');
  reset role;
  assert exists (select 1 from public.messages mm join public.conversations cc on cc.id = mm.conversation_id
                 where mm.author_id = a and cc.kind = 'dm'), 'A has DM messages';
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"onAccountDelete": "eraseDms"}');
  perform public.messaging_on_account_delete(a);
  assert not exists (select 1 from public.messages mm join public.conversations cc on cc.id = mm.conversation_id
                     where mm.author_id = a and cc.kind = 'dm'), 'eraseDms: the DM messages go';
  assert exists (select 1 from public.messages where author_id = a and conversation_id = g), 'the group ones stay';
  perform public.messaging_set_settings('{"onAccountDelete": "keep"}');

  -- Merge: A and A2 both have a DM with B (and with C): one conversation each, all messages.
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  a2b := public.start_dm(b);
  perform public.send_message(a2b, 'from a2');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.send_message(ab, 'from b');
  reset role;
  select count(*) into n from public.messages where conversation_id in (ab, a2b);
  perform public.merge_messaging(a, a2);
  assert (select count(*) from public.conversations where id in (ab, a2b)) = 1, 'two DMs with B become one';
  select p.conversation_id into ab from public.dm_pairs p where p.user_a = least(a, b) and p.user_b = greatest(a, b);
  assert ab is not null and (select count(*) from public.messages where conversation_id = ab) = n,
    'with all their messages';
  assert (select count(*) from public.conversation_members where conversation_id = ab) = 2
    and (select state from public.conversation_members where conversation_id = ab and user_id = b) = 'active',
    'two members, B active';
  assert (select count(*) from public.dm_pairs p where p.user_a = least(a, c) and p.user_b = greatest(a, c)) = 1,
    'one DM with C';
  assert not exists (select 1 from public.conversation_members where user_id = a2), 'A2 has no memberships left';
  assert not exists (select 1 from public.dm_pairs where a2 in (user_a, user_b)), 'nor pairs';
  assert not exists (select 1 from public.dm_declines where a2 in (sender_id, recipient_id)), 'nor declines';

  raise exception 'DMS_TESTS_PASSED';
end $$;
