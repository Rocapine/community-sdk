-- Messaging core (messaging/001_messaging.sql).
-- Run against a backend with it applied:
--   npx supabase db query --remote=<ref> --yes -f supabase-tests/messaging.sql
-- It builds one group conversation between four existing profiles (a creator, b
-- member, c removed, x outsider) and always rolls back by raising at the end: the
-- run passed when the error message is exactly MESSAGING_TESTS_PASSED.
do $$
declare
  ids uuid[];
  a uuid; b uuid; c uuid; x uuid;
  conv uuid;
  m public.messages;
  m_ro public.messages;
  m_del public.messages;
  r record;
  n int;
begin
  select array_agg(id) into ids from (
    select id from public.profiles where not is_banned and not is_admin limit 4
  ) s;
  assert coalesce(array_length(ids, 1), 0) = 4, 'needs four member profiles';
  a := ids[1]; b := ids[2]; c := ids[3]; x := ids[4];
  delete from public.blocks where blocker_id = any (ids) or blocked_id = any (ids);

  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings(
    '{"moderation": "post", "maxLength": 2000, "ratePerMinute": 100, "groupsPreview": "none"}');

  insert into public.conversations (kind) values ('group') returning id into conv;
  insert into public.conversation_members (conversation_id, user_id, role, state, joined_at) values
    (conv, a, 'creator', 'active', now() - interval '1 hour'),
    (conv, b, 'member', 'active', now() - interval '1 hour'),
    (conv, c, 'member', 'removed', now() - interval '1 hour');

  -- B writes: up to maxLength, not one more; 'post' shows the message unmoderated.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  m := public.send_message(conv, repeat('a', 2000));
  assert m.status = 'visible' and m.moderated_at is null, 'post: visible, queued for the AI';
  begin
    perform public.send_message(conv, repeat('a', 2001));
    assert false, 'a 2001-char message is refused';
  exception when raise_exception then
    assert sqlerrm = 'message_too_long', 'got ' || sqlerrm;
  end;
  begin
    perform public.send_message(conv, '   ');
    assert false, 'an empty message is refused';
  exception when raise_exception then
    assert sqlerrm = 'empty_message', 'got ' || sqlerrm;
  end;
  begin
    perform public.send_message(conv, null, null, a || '/' || b || '/x.jpg');
    assert false, 'an image outside the conversation folder is refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_image_path', 'got ' || sqlerrm;
  end;
  reset role;

  -- reportOnly: visible and never sent to the AI; an image waits whatever the mode.
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"moderation": "reportOnly"}');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  m_ro := public.send_message(conv, 'report only');
  assert m_ro.status = 'visible' and m_ro.moderated_at is not null, 'reportOnly: visible, moderated_at set';
  m_del := public.send_message(conv, 'with image', null, conv || '/' || b || '/photo.jpg');
  assert m_del.status = 'pending' and m_del.moderated_at is null, 'an image: pending';
  reset role;
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"moderation": "pre"}');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (public.send_message(conv, 'pre')).status = 'pending', 'pre: pending';
  assert (select count(*) from public.messages where conversation_id = conv) = 4,
    'the author reads their own pending messages';
  reset role;

  -- C was removed, X never joined: neither writes nor reads.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.send_message(conv, 'hi');
    assert false, 'a removed member cannot write';
  exception when raise_exception then
    assert sqlerrm = 'not_a_member', 'got ' || sqlerrm;
  end;
  assert (select count(*) from public.messages where conversation_id = conv) = 0, 'nor read';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.messages where conversation_id = conv) = 0,
    'an outsider reads nothing with groupsPreview none';
  assert (select count(*) from public.conversations where id = conv) = 0, 'nor the conversation';
  assert not public.can_read_conversation(conv), 'cannot read';
  begin
    perform public.set_message_like(m.id, true);
    assert false, 'an outsider cannot like';
  exception when raise_exception then
    assert sqlerrm = 'not_found', 'got ' || sqlerrm;
  end;
  reset role;

  -- A reads B's two visible messages (not the pending ones), unread until A reads.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.messages where conversation_id = conv) = 2, 'A reads the visible ones';
  select * into r from public.list_conversations() l where l.conversation_id = conv;
  assert r.unread = 2 and r.role = 'creator', 'two unread for A, the creator';
  perform public.set_message_like(m.id, true);
  assert (select count(*) from public.message_likes where message_id = m.id) = 1, 'A liked';
  reset role;

  -- B edits: the old version is kept, translations dropped, edited_at set.
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"moderation": "post"}');
  insert into public.message_translations (message_id, locale, body) values (m.id, 'fr', 'traduit');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  m := public.edit_message(m.id, 'edited');
  assert m.edited_at is not null and m.body = 'edited' and m.status = 'visible', 'edited';
  -- B deletes their own message: a placeholder remains.
  perform public.delete_message(m_ro.id);
  select * into m_ro from public.messages where id = m_ro.id;
  assert m_ro.body is null and m_ro.status = 'deleted' and m_ro.deleted_by = 'author',
    'author delete leaves a placeholder';
  -- B is no admin: the dashboard context is closed.
  begin
    perform public.admin_message_context(m.id);
    assert false, 'admin_message_context is admin-only';
  exception when raise_exception then
    assert sqlerrm = 'forbidden', 'got ' || sqlerrm;
  end;
  reset role;
  assert (select count(*) from public.message_versions where message_id = m.id) = 1, 'one version kept';
  assert (select body from public.message_versions where message_id = m.id) = repeat('a', 2000),
    'the version is the original';
  assert (select count(*) from public.message_translations where message_id = m.id) = 0,
    'translations dropped';
  assert (select body from public.message_versions where message_id = m_ro.id) = 'report only',
    'the deleted original is kept';

  -- The creator deletes B's message; B cannot delete A's.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  m_del := public.send_message(conv, 'from a');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.delete_message(m_del.id);
    assert false, 'a member cannot delete another member''s message';
  exception when raise_exception then
    assert sqlerrm = 'forbidden', 'got ' || sqlerrm;
  end;
  m_del := public.send_message(conv, 'to be removed');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.delete_message(m_del.id);
  select * into m_del from public.messages where id = m_del.id;
  assert m_del.deleted_by = 'creator' and m_del.body is null, 'the creator deletes';

  -- A blocks B: B's messages disappear for A, unread included.
  insert into public.blocks (blocker_id, blocked_id) values (a, b);
  assert (select count(*) from public.messages where conversation_id = conv and author_id = b) = 0,
    'A no longer reads B';
  select * into r from public.list_conversations() l where l.conversation_id = conv;
  assert r.unread = 0, 'nor counts B as unread';
  assert r.last_author_id = a, 'the last message shown is A''s';
  reset role;

  -- The rate limit: ratePerMinute messages within 60 s, not one more.
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"ratePerMinute": 20}');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.messages where author_id = b;
  for i in n + 1 .. 20 loop
    perform public.send_message(conv, 'msg ' || i);
  end loop;
  begin
    perform public.send_message(conv, 'one too many');
    assert false, 'the 21st message within a minute is refused';
  exception when raise_exception then
    assert sqlerrm = 'rate_limited', 'got ' || sqlerrm;
  end;
  reset role;
  assert (select count(*) from public.messages where author_id = b) = 20, 'exactly 20 went through';

  raise exception 'MESSAGING_TESTS_PASSED';
end $$;
