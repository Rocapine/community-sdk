-- Groups module (groups/001_groups.sql, accounts/003_merge_hooks.sql).
-- Run against a backend with messaging/001 and groups/001 applied:
--   npx supabase db query --project-ref <ref> --linked --yes -f supabase-tests/groups.sql
-- It creates five auth users (so five profiles: a creator, b, c members, x outsider, adm an
-- in-app admin) and always rolls back by raising at the end: the run passed when the error
-- message is exactly GROUPS_TESTS_PASSED. The accounts, presence and inbox parts run only
-- where those modules are installed.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  x uuid := gen_random_uuid();
  adm uuid := gen_random_uuid();
  g1 uuid; g2 uuid; g3 uuid; gx uuid;
  m public.messages;
  r record;
  failed boolean;
begin
  insert into auth.users (id) values (a), (b), (c), (x), (adm);
  update public.profiles set is_admin = true where id = adm;

  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"groupsCreateRequiresAccount": false, "groupsRequireAccount": false,
    "maxCreatedPerMember": 3, "maxJoinedPerMember": 50, "maxMembers": null, "nameMaxLength": 60,
    "descriptionMaxLength": 500, "groupsPreview": "readOnly", "moderation": "post", "ratePerMinute": 100,
    "onAccountDelete": "keep"}');

  -- A creates three groups; a fourth is refused; lengths are checked.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_group(repeat('n', 61), 'd');
    assert false, 'a 61-char name is refused';
  exception when raise_exception then
    assert sqlerrm = 'name_too_long', 'got ' || sqlerrm;
  end;
  begin
    perform public.create_group('n', repeat('d', 501));
    assert false, 'a 501-char description is refused';
  exception when raise_exception then
    assert sqlerrm = 'description_too_long', 'got ' || sqlerrm;
  end;
  begin
    perform public.create_group('n', 'd', 'pending/' || b || '/x.jpg');
    assert false, 'an image outside the caller''s pending folder is refused';
  exception when raise_exception then
    assert sqlerrm = 'invalid_image_path', 'got ' || sqlerrm;
  end;
  g1 := public.create_group('City runners', 'We run together', 'pending/' || a || '/cover.jpg');
  g2 := public.create_group('Second', 'two');
  g3 := public.create_group('Third', 'three');
  begin
    perform public.create_group('Fourth', 'four');
    assert false, 'a fourth group is refused';
  exception when raise_exception then
    assert sqlerrm = 'too_many_groups', 'got ' || sqlerrm;
  end;
  assert (select name is null and pending_name = 'City runners' and status = 'pending'
            and pending_image_path = 'pending/' || a || '/cover.jpg'
          from public.groups where conversation_id = g1), 'A reads its pending group, values pending';
  select role, notify, state into r from public.conversation_members where conversation_id = g1 and user_id = a;
  assert r.role = 'creator' and not r.notify and r.state = 'active', 'A is the creator, notifications off';
  reset role;

  -- An in-app admin is not limited.
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1 .. 4 loop
    gx := public.create_group('Admin ' || i, '');
  end loop;
  reset role;

  -- A pending group is invisible to B until moderation approves it.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.search_groups() s where s.group_id = g1) = 0, 'B does not find a pending group';
  assert (select count(*) from public.groups where conversation_id = g1) = 0, 'nor reads it';
  begin
    perform public.join_group(g1);
    assert false, 'B cannot join a pending group';
  exception when raise_exception then
    assert sqlerrm = 'not_found', 'got ' || sqlerrm;
  end;
  reset role;
  update public.groups
     set status = 'visible', name = pending_name, description = pending_description,
         pending_name = null, pending_description = null
   where conversation_id in (g1, g2, g3);
  insert into public.group_translations (group_id, locale, name, description)
    values (g1, 'fr', 'Coureurs de Lyon', 'On court ensemble à Lyon');

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.search_groups() s where s.group_id = g1) = 1, 'B finds it once visible';
  assert (select name from public.search_groups('lyon', 'fr') s where s.group_id = g1) = 'Coureurs de Lyon',
    'found through its French translation, returned translated';
  assert (select count(*) from public.search_groups('lyon', 'en')) = 0, 'not in another locale';
  assert (select count(*) from public.search_groups('runners', 'fr') s where s.group_id = g1) = 1,
    'the original still matches';
  perform public.join_group(g1);
  perform public.join_group(g1);
  assert (select member_count from public.groups where conversation_id = g1) = 2, 'joining is idempotent';
  assert (select is_member from public.search_groups() s where s.group_id = g1), 'B is a member';
  perform public.set_group_notify(g1, true);
  assert (select notify from public.conversation_members where conversation_id = g1 and user_id = b),
    'B follows the group';
  m := public.send_message(g1, 'hello');
  reset role;

  -- A message bumps the group's activity.
  update public.groups set last_activity_at = '2000-01-01' where conversation_id = g1;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.send_message(g1, 'again');
  reset role;
  assert (select last_activity_at > now() - interval '1 minute' from public.groups where conversation_id = g1),
    'last_activity_at follows the messages';

  -- The creator removes B; B cannot rejoin until readmitted.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.remove_member(g1, b);
  perform public.remove_member(g1, b);
  reset role;
  assert (select state = 'removed' and removed_by = a from public.conversation_members
          where conversation_id = g1 and user_id = b), 'B is removed';
  assert (select member_count from public.groups where conversation_id = g1) = 1, 'and no longer counted';
  if to_regclass('public.notifications') is not null then
    assert (select count(*) from public.notifications
            where user_id = b and kind = 'group_member_removed' and conversation_id = g1) = 1,
      'B is told once';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.join_group(g1);
    assert false, 'a removed member cannot rejoin';
  exception when raise_exception then
    assert sqlerrm = 'removed_from_group', 'got ' || sqlerrm;
  end;
  assert not public.can_read_conversation(g1), 'nor previews the group';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.readmit_member(g1, b);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.can_read_conversation(g1), 'readmitted, B previews again';
  perform public.join_group(g1);
  assert (select role = 'member' and state = 'active' and not notify from public.conversation_members
          where conversation_id = g1 and user_id = b), 'B is back as a member, notifications off';
  reset role;

  -- The creator never removes an admin; an outsider never lists members.
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.join_group(g1);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.join_group(g1);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.remove_member(g1, adm);
    assert false, 'the creator cannot remove an admin';
  exception when raise_exception then
    assert sqlerrm = 'forbidden', 'got ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.list_conversation_members(g1);
    assert false, 'a non-member cannot list members';
  exception when raise_exception then
    assert sqlerrm = 'forbidden', 'got ' || sqlerrm;
  end;
  begin
    perform public.remove_member(g1, b);
    assert false, 'an outsider cannot remove';
  exception when raise_exception then
    assert sqlerrm = 'forbidden', 'got ' || sqlerrm;
  end;
  begin
    perform public.edit_group(g1, 'Mine', null, null);
    assert false, 'an outsider cannot edit';
  exception when raise_exception then
    assert sqlerrm = 'forbidden', 'got ' || sqlerrm;
  end;
  reset role;

  -- A blocks B: B leaves A's member list and A's online count.
  insert into public.blocks (blocker_id, blocked_id) values (a, b);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.list_conversation_members(g1)) = 3, 'A lists A, C and the admin';
  assert (select role from public.list_conversation_members(g1) l where l.user_id = a) = 'creator', 'A is the creator';
  assert (select count(*) from public.list_conversation_members(g1, 'zzz-no-match')) = 0, 'the query filters';
  reset role;
  if to_regclass('public.member_presence') is not null then
    -- B (blocked by A) and C (hidden) are online, the admin too, visibly.
    insert into public.member_presence (user_id, last_active_at, visible) values
      (b, now(), true), (c, now(), false), (adm, now(), true)
    on conflict (user_id) do update set last_active_at = excluded.last_active_at, visible = excluded.visible;
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    assert (select online from public.group_online_counts(array[g1, g2]) o where o.group_id = g1) = 1,
      'A counts the admin only (C hidden, B blocked)';
    assert (select online from public.group_online_counts(array[g1, g2]) o where o.group_id = g2) = 0,
      'nobody online in g2';
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    set local role authenticated;
    assert (select online from public.group_online_counts(array[g1]) o where o.group_id = g1) = 2,
      'X counts B and the admin';
    reset role;
  end if;
  delete from public.blocks where blocker_id = a and blocked_id = b;

  -- Edits wait for moderation; the creator leaving keeps the group; deletion removes everyone.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.edit_group(g1, 'City runners club', 'New description', null);
  reset role;
  assert (select name = 'City runners' and pending_name = 'City runners club' and status = 'visible'
          from public.groups where conversation_id = g1), 'an edit stays pending, the live name stays';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.leave_group(g1);
  begin
    perform public.edit_group(g1, 'Back', null, null);
    assert false, 'a creator who left no longer manages the group';
  exception when raise_exception then
    assert sqlerrm = 'forbidden', 'got ' || sqlerrm;
  end;
  reset role;
  assert (select status = 'visible' and member_count = 3 from public.groups where conversation_id = g1),
    'the group lives on without its creator';
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.delete_group(g1);
  reset role;
  assert (select status = 'deleted' and member_count = 0 from public.groups where conversation_id = g1),
    'an admin deletes the group';
  assert not exists (select 1 from public.conversation_members where conversation_id = g1 and state = 'active'),
    'nobody is a member any more';

  -- Dashboard tools: transfer and live edits, never from the app.
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_transfer_group(g2, b);
    assert false, 'admin_transfer_group is dashboard-only';
  exception when raise_exception then
    assert sqlerrm = 'forbidden', 'got ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.admin_transfer_group(g2, b);
  perform public.admin_edit_group(g2, 'Renamed', null, null);
  assert (select created_by = b and name = 'Renamed' and description = 'two' from public.groups where conversation_id = g2),
    'transferred and renamed live';
  assert (select role from public.conversation_members where conversation_id = g2 and user_id = b) = 'creator'
    and (select role from public.conversation_members where conversation_id = g2 and user_id = a) = 'member',
    'B is the creator, A a member';

  -- Reports: a group (naming its creator) or a message; never nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.reports (reporter_id, reported_user_id, group_id, reason) values (c, b, g2, 'spam');
  begin
    insert into public.reports (reporter_id, reported_user_id, group_id, reason) values (c, x, g2, 'spam');
    assert false, 'a group report names its creator';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.join_group(g3);
  m := public.send_message(g3, 'reported');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.reports (reporter_id, reported_user_id, message_id, reason) values (a, b, m.id, 'spam');
  begin
    insert into public.reports (reporter_id, reported_user_id, reason) values (a, b, 'spam');
    assert false, 'a report needs a target';
  exception when check_violation then null;
  end;
  reset role;

  -- Account rules, where the accounts module is installed.
  if to_regclass('public.account_links') is not null then
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    perform public.messaging_set_settings('{"groupsCreateRequiresAccount": true, "groupsRequireAccount": true}');
    perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.create_group('No account', '');
      assert false, 'creating needs an account';
    exception when raise_exception then
      assert sqlerrm = 'account_required', 'got ' || sqlerrm;
    end;
    begin
      perform public.join_group(g3);
      assert false, 'joining needs an account';
    exception when raise_exception then
      assert sqlerrm = 'account_required', 'got ' || sqlerrm;
    end;
    reset role;
    insert into public.account_links (provider, subject, profile_id) values ('test', 'groups-x', x);
    perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.create_group('With account', '');
    perform public.join_group(g3);
    reset role;
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    perform public.messaging_set_settings('{"groupsCreateRequiresAccount": false, "groupsRequireAccount": false}');
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.join_group(g3);
  m := public.send_message(g3, 'liked by both');
  reset role;

  -- Profile merge: A and B are both in g3; B's message and like move to A.
  if to_regprocedure('public.merge_profiles(uuid,uuid)') is not null then
    foreach gx in array array[a, b] loop
      perform set_config('request.jwt.claims', json_build_object('sub', gx, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.set_message_like(m.id, true);
      reset role;
    end loop;
    assert (select like_count from public.messages where id = m.id) = 2, 'two likes before the merge';
    perform public.merge_profiles(a, b);
    assert (select count(*) from public.conversation_members where conversation_id = g3 and user_id = a and state = 'active') = 1,
      'one active row for main';
    assert (select role from public.conversation_members where conversation_id = g3 and user_id = a) = 'creator',
      'main stays the creator';
    assert not exists (select 1 from public.conversation_members where user_id = b), 'other has no memberships left';
    assert not exists (select 1 from public.messages where author_id = b), 'other''s messages are main''s';
    assert (select count(*) from public.message_likes where message_id = m.id) = 1
      and (select like_count from public.messages where id = m.id) = 1, 'one like, counted once';
    assert (select created_by from public.groups where conversation_id = g2) = a, 'the groups other created are main''s';
    assert (select member_count from public.groups where conversation_id = g3) =
      (select count(*) from public.conversation_members where conversation_id = g3 and state = 'active'),
      'member_count is recounted';
  end if;

  -- Account deletion: keep leaves the messages, eraseAll deletes them.
  perform public.messaging_on_account_delete(adm);
  assert exists (select 1 from public.messages where author_id = adm), 'keep: the messages stay';
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform public.messaging_set_settings('{"onAccountDelete": "eraseAll"}');
  perform public.messaging_on_account_delete(adm);
  assert not exists (select 1 from public.messages where author_id = adm), 'eraseAll: the messages go';

  -- Clients never call the dashboard and service functions; anon calls nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  failed := false;
  begin
    perform public.messaging_on_account_delete(c);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'authenticated must not call messaging_on_account_delete';
  failed := false;
  begin
    perform public.merge_messaging(c, x);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'authenticated must not call merge_messaging';
  reset role;
  set local role anon;
  failed := false;
  begin
    perform public.search_groups();
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'anon must not search groups';
  reset role;

  raise exception 'GROUPS_TESTS_PASSED';
end $$;
