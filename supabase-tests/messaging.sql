-- Messaging core (messaging/001_messaging.sql, 005_review_fixes.sql).
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
  m_img public.messages;
  conv2 uuid;
  rep uuid;
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
  m_img := public.send_message(conv, 'with image', null, conv || '/' || b || '/photo.jpg');
  assert m_img.status = 'pending' and m_img.moderated_at is null, 'an image: pending';
  reset role;
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  begin
    perform public.messaging_set_settings('{"maxLength": 5000}');
    assert false, 'maxLength above the 4000 cap is refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_setting:maxLength', 'got ' || sqlerrm;
  end;
  begin
    perform public.messaging_set_settings('{"moderation": "later"}');
    assert false, 'an unknown moderation mode is refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_setting:moderation', 'got ' || sqlerrm;
  end;
  begin
    perform public.messaging_set_settings('{"maxlength": 100}');
    assert false, 'an unknown key is refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_setting:maxlength', 'got ' || sqlerrm;
  end;
  perform public.messaging_set_settings('{"maxMembers": null, "groupsRequireAccount": false}');
  -- No JWT at all: a direct database session (the SQL editor) may set them too.
  perform set_config('request.jwt.claims', '', true);
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
  perform public.set_message_like(m.id, true);
  assert (select count(*) from public.message_likes where message_id = m.id) = 1, 'A liked';
  assert (select like_count from public.messages where id = m.id) = 1, 'counted once';
  perform public.set_message_like(m.id, false);
  perform public.set_message_like(m.id, false);
  assert (select like_count from public.messages where id = m.id) = 0, 'uncounted once';
  perform public.set_message_like(m.id, true);
  -- A reports B's message.
  insert into public.reports (reporter_id, reported_user_id, message_id, reason)
    values (a, b, m.id, 'spam');
  reset role;

  -- Message images: the uploader reads their file; others only once the message is visible.
  insert into storage.objects (bucket_id, name, owner_id)
    values ('message-images', m_img.image_path, b::text);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from storage.objects where name = m_img.image_path) = 0,
    'a pending image stays private';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from storage.objects where name = m_img.image_path) = 1, 'its uploader reads it';
  reset role;
  update public.messages set status = 'visible' where id = m_img.id;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from storage.objects where name = m_img.image_path) = 1,
    'a visible image is readable by members';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from storage.objects where name = m_img.image_path) = 0, 'not by outsiders';
  begin
    insert into public.reports (reporter_id, reported_user_id, message_id, reason)
      values (x, b, m.id, 'spam');
    assert false, 'an outsider cannot report a message they cannot read';
  exception when insufficient_privilege then null;
  end;
  reset role;
  update public.messages set status = 'hidden' where id = m_img.id;

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
  reset role;
  -- messaging/005: a banned creator no longer deletes others' messages.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  m_del := public.send_message(conv, 'not removed by a banned creator');
  reset role;
  update public.profiles set is_banned = true where id = a;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.delete_message(m_del.id);
    assert false, 'a banned creator cannot delete another member''s message';
  exception when raise_exception then
    assert sqlerrm = 'forbidden', 'got ' || sqlerrm;
  end;
  reset role;
  update public.profiles set is_banned = false where id = a;
  assert (select status = 'visible' from public.messages where id = m_del.id), 'the message stays';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

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
  select count(*) into n from public.messages
  where author_id = b and created_at > now() - interval '60 seconds';
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
  assert (select count(*) from public.messages
          where author_id = b and created_at > now() - interval '60 seconds') = 20,
    'exactly 20 went through';
  -- Parallel sends (the advisory lock in send_message) can't be shown in one transaction.

  -- messaging/005: edits share that budget (sends plus edits of the last 60 s).
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.edit_message(m.id, 'edited again');
    assert false, 'an edit past the per-minute budget is refused';
  exception when raise_exception then
    assert sqlerrm = 'rate_limited', 'got ' || sqlerrm;
  end;
  reset role;
  select (select count(*) from public.messages
          where author_id = b and created_at > now() - interval '60 seconds')
       + (select count(*) from public.message_versions v join public.messages mm on mm.id = v.message_id
          where mm.author_id = b and v.replaced_at > now() - interval '60 seconds')
    into n;
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings(jsonb_build_object('ratePerMinute', n + 1));
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  m := public.edit_message(m.id, 'edited');
  assert m.body = 'edited', 'one edit fits in the budget left';
  begin
    perform public.edit_message(m.id, 'edited once more');
    assert false, 'the next edit is refused';
  exception when raise_exception then
    assert sqlerrm = 'rate_limited', 'got ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"ratePerMinute": 20}');

  -- An admin account hides a message.
  update public.profiles set is_admin = true where id = x;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.delete_message(m.id);
  reset role;
  assert (select status = 'hidden' and deleted_by = 'admin' and body = 'edited'
          from public.messages where id = m.id), 'the admin hides, the text stays for the dashboard';
  update public.profiles set is_admin = false where id = x;

  -- A report outlives its target; a report without one is refused.
  insert into public.conversations (kind) values ('group') returning id into conv2;
  insert into public.conversation_members (conversation_id, user_id) values (conv2, a), (conv2, c);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  m_del := public.send_message(conv2, 'reported');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.reports (reporter_id, reported_user_id, message_id, reason)
    values (c, a, m_del.id, 'harassment');
  begin
    insert into public.reports (reporter_id, reported_user_id, reason) values (c, a, 'spam');
    assert false, 'a report needs a target';
  exception when check_violation then null;
  end;
  reset role;
  select id into rep from public.reports where message_id = m_del.id;
  delete from public.conversations where id = conv2;
  assert (select message_id is null from public.reports where id = rep),
    'deleting the conversation keeps the report';

  -- A removed member doesn't read a previewable group. Before the groups module, a
  -- stand-in table plays public.groups for this transaction.
  if to_regclass('public.groups') is null then
    create table public.groups (conversation_id uuid primary key, status text not null);
    grant select on public.groups to authenticated;
  end if;
  insert into public.groups (conversation_id, status) values (conv, 'visible');
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"groupsPreview": "readOnly"}');
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.can_read_conversation(conv), 'an outsider previews a visible group';
  assert (select count(*) from public.messages where conversation_id = conv) > 0, 'and reads it';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert not public.can_read_conversation(conv), 'a removed member does not';
  assert (select count(*) from public.messages where conversation_id = conv) = 0, 'nor reads it';
  reset role;

  raise exception 'MESSAGING_TESTS_PASSED';
end $$;
