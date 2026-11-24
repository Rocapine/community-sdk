-- Account links and profile merge (accounts/001_accounts.sql).
-- Run against a backend with core applied, after accounts/001:
--   npx supabase db query --linked --yes -f supabase-tests/accounts.sql
-- It creates two auth users (so two profiles), merges them and always rolls back by raising at the
-- end: the run passed when the error message is exactly ACCOUNTS_TESTS_PASSED.
do $$
declare
  m uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
  p_both uuid; p_o uuid;
  c_both uuid; c_o uuid; opt uuid; x uuid := gen_random_uuid(); y uuid := gen_random_uuid(); p_y uuid;
  r text; fn text;
  rec record;
  n int;
  failed boolean;
  -- Every "table.column" that merge_profiles moves; a new foreign key to profiles must be added to
  -- merge_profiles AND here.
  handled text[] := array[
    'posts.author_id', 'comments.author_id', 'likes.user_id', 'blocks.blocker_id', 'blocks.blocked_id',
    'reports.reporter_id', 'reports.reported_user_id', 'moderation_actions.target_user_id',
    'post_drafts.author_id', 'notifications.user_id', 'notifications.actor_id',
    'notification_seen.user_id', 'notification_reads.user_id', 'poll_votes.user_id',
    'post_reactions.user_id', 'member_presence.user_id', 'push_tokens.user_id', 'push_devices.user_id'];
begin
  insert into auth.users (id) values (m), (o), (x), (y);
  assert exists (select 1 from public.profiles where id = m), 'the auth trigger creates the profile';

  -- Content: o has a post and two comments, m has a post.
  insert into public.posts (author_id, content, status) values (m, 'm post', 'visible') returning id into p_both;
  insert into public.posts (author_id, content, status) values (o, 'o post', 'visible') returning id into p_o;
  insert into public.comments (post_id, author_id, content, status) values (p_both, o, 'o comment', 'visible') returning id into c_o;
  insert into public.comments (post_id, author_id, content, status) values (p_both, m, 'm comment', 'visible') returning id into c_both;
  insert into public.comments (post_id, author_id, content, status) values (p_o, o, 'o comment 2', 'visible');
  -- A like by both on the same post, one like by o alone, comment likes the same way.
  insert into public.likes (post_id, user_id) values (p_both, m), (p_both, o), (p_o, o);
  insert into public.comment_likes (comment_id, user_id) values (c_both, m), (c_both, o), (c_o, o);
  -- A block between the two must vanish, not become a self-block.
  insert into public.blocks (blocker_id, blocked_id) values (o, m);
  insert into public.reports (reporter_id, reported_user_id, post_id, reason) values (o, m, p_both, 'spam'), (m, o, p_o, 'spam');
  insert into public.moderation_actions (actor_email, action, target_user_id) values ('t@example.com', 'ban', o);
  insert into public.post_drafts (author_id, created_by, updated_by) values (o, 't@example.com', 't@example.com');
  if to_regclass('public.notifications') is not null then
    insert into public.notifications (user_id, kind, actor_id, post_id) values (o, 'test', x, p_both), (x, 'test', o, p_both);
  end if;
  -- Optional modules, only where installed.
  if to_regclass('public.post_reactions') is not null then
    insert into public.post_reactions (post_id, user_id) values (p_both, m), (p_both, o), (p_o, o);
  end if;
  if to_regclass('public.notification_reads') is not null then
    insert into public.notification_reads (user_id, item_id) values (m, p_both), (o, p_both), (o, p_o);
  end if;
  if to_regclass('public.notification_seen') is not null then
    insert into public.notification_seen (user_id) values (m), (o);
  end if;
  if to_regclass('public.member_presence') is not null then
    insert into public.member_presence (user_id) values (m), (o);
  end if;
  if to_regclass('public.push_tokens') is not null then
    insert into public.push_tokens (user_id, expo_push_token) values (m, 'main'), (o, 'other');
  end if;
  if to_regclass('public.push_devices') is not null then
    insert into public.push_devices (user_id, device_id, expo_push_token) values (m, 'd1', 'a'), (o, 'd1', 'b'), (o, 'd2', 'c');
  end if;
  if to_regclass('public.poll_votes') is not null then
    insert into public.poll_options (post_id, idx, label) values (p_both, 0, 'x') returning id into opt;
    insert into public.poll_votes (post_id, option_id, user_id) values (p_both, opt, m), (p_both, opt, o);
  end if;

  -- Identity: m has the default name, o chose one; o is banned and admin.
  update public.profiles set username = 'Default 1', default_username = 'Default 1' where id = m;
  update public.profiles set username = 'Chosen', username_set_by_user = true, bio = 'hi', is_banned = true, is_admin = true where id = o;

  perform public.merge_profiles(m, o);

  assert (select count(*) from public.posts where author_id = o) = 0, 'o has no posts left';
  assert (select count(*) from public.comments where author_id = o) = 0, 'o has no comments left';
  assert (select count(*) from public.posts where author_id = m) = 2, 'm has both posts';
  assert (select count(*) from public.comments where author_id = m) = 3, 'm has all comments';
  assert (select count(*) from public.likes where post_id = p_both and user_id = m) = 1, 'one like on the shared post, not two';
  assert (select count(*) from public.likes where user_id = m) = 2, 'o''s other like moved to m';
  assert (select count(*) from public.comment_likes where comment_id = c_both and user_id = m) = 1, 'one comment like, not two';
  assert (select count(*) from public.blocks where blocker_id = m and blocked_id = m) = 0, 'no self-block';
  assert (select count(*) from public.reports where reporter_id = m and reported_user_id = m) = 2, 'reports moved';
  assert (select count(*) from public.moderation_actions where target_user_id = m) = 1, 'moderation action moved';
  assert (select count(*) from public.post_drafts where author_id = m) = 1, 'draft moved';
  if to_regclass('public.notifications') is not null then
    assert (select count(*) from public.notifications where user_id = m and actor_id = x and kind = 'test') = 1, 'notification user_id moved';
    assert (select count(*) from public.notifications where user_id = x and actor_id = m and kind = 'test') = 1, 'notification actor_id moved';
  end if;
  if to_regclass('public.push_devices') is not null then
    assert (select expo_push_token from public.push_devices where user_id = m and device_id = 'd1') = 'a', 'main keeps its device row';
    assert (select count(*) from public.push_devices where user_id = m) = 2, 'o''s other device moved';
  end if;
  if to_regclass('public.poll_votes') is not null then
    assert (select count(*) from public.poll_votes where user_id = m) = 1, 'one poll vote kept';
  end if;
  if to_regclass('public.push_tokens') is not null then
    assert (select expo_push_token from public.push_tokens where user_id = m) = 'main', 'main keeps its push token';
  end if;

  assert (select is_banned from public.profiles where id = m), 'a banned other bans main';
  assert not (select is_admin from public.profiles where id = m), 'is_admin is never taken from other';
  assert (select username from public.profiles where id = m) = 'Chosen', 'main with the default name takes the chosen one';
  assert (select bio from public.profiles where id = m) = 'hi', 'and the bio';
  assert (select username_set_by_user from public.profiles where id = m), 'and now counts as chosen';

  -- Both chosen: main keeps its own.
  perform set_config('community.trusted', 'on', true);
  update public.profiles set username = 'Mine', username_set_by_user = true, bio = 'mine', is_banned = false where id = m;
  update public.profiles set username = 'Theirs', username_set_by_user = true, bio = 'theirs', is_banned = false where id = o;
  perform set_config('community.trusted', '', true);
  perform public.merge_profiles(m, o);
  assert (select username from public.profiles where id = m) = 'Mine', 'both chosen: main keeps its name';
  assert (select bio from public.profiles where id = m) = 'mine', 'both chosen: main keeps its bio';
  assert not (select is_banned from public.profiles where id = m), 'not banned stays not banned';

  -- FK coverage: every foreign key to profiles(id) is handled, and nothing still points at o.
  for rec in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
      and c.conrelid <> 'public.account_links'::regclass -- not moved: deleting `other` cascades its link
      and c.connamespace = 'public'::regnamespace -- the SDK's own tables; a host's tables are its business
  loop
    assert (replace(rec.tbl, 'public.', '') || '.' || rec.col) = any (handled),
      'merge_profiles does not handle ' || rec.tbl || '.' || rec.col;
    execute format('select count(*) from %s where %I = $1', rec.tbl, rec.col) into n using o;
    assert n = 0, rec.tbl || '.' || rec.col || ' still points at the merged profile';
  end loop;

  -- Same-profile merge is a no-op, a missing profile is an error.
  perform public.merge_profiles(m, m);
  failed := false;
  begin
    perform public.merge_profiles(m, gen_random_uuid());
  exception when others then failed := true;
  end;
  assert failed, 'merging a missing profile raises';

  -- account_link_and_merge: link once, merge the list, report whether the link is new.
  assert public.account_link_and_merge('test', 'subject-1', m, array[o]), 'the first link is new';
  assert not public.account_link_and_merge('test', 'subject-1', m, '{}'), 'the second is not';
  assert (select profile_id from public.account_links where provider = 'test' and subject = 'subject-1') = m, 'link stored';

  -- An account linked to another profile, or a profile linked to another account: raise, merge nothing.
  insert into public.posts (author_id, content, status) values (y, 'y post', 'visible') returning id into p_y;
  failed := false;
  begin
    perform public.account_link_and_merge('test', 'subject-1', x, array[y]);
  exception when unique_violation then failed := true;
  end;
  assert failed, 'linking an account to a second profile raises';
  failed := false;
  begin
    perform public.account_link_and_merge('test', 'subject-2', m, array[y]);
  exception when unique_violation then failed := true;
  end;
  assert failed, 'linking a profile to a second account raises';
  assert (select author_id from public.posts where id = p_y) = y, 'nothing merged on a conflict';
  assert (select count(*) from public.account_links where subject = 'subject-2') = 0, 'no second link';

  -- Lookups for account-session.
  update public.posts set created_at = now() + interval '1 day' where id = p_y;
  assert (select at from public.account_last_active(array[y])) = (select created_at from public.posts where id = p_y),
    'last activity is the latest post';
  assert (select count(*) from public.account_last_active(array[m, y])) = 2, 'one row per profile';
  update auth.users set email = 'account+abc@account.invalid' where id = x;
  assert public.account_user_id_by_email('account+abc@account.invalid') = x, 'user found by email';
  assert public.account_user_id_by_email('nobody@account.invalid') is null, 'no user, null';

  -- reset_profile_identity_for: default name back, bio and avatar cleared.
  update public.profiles set default_username = 'Default 1', bio = 'x', avatar_url = 'y' where id = m;
  perform public.reset_profile_identity_for(m);
  assert (select username from public.profiles where id = m) = 'Default 1', 'name reset';
  assert (select bio from public.profiles where id = m) is null, 'bio cleared';
  assert not (select username_set_by_user from public.profiles where id = m), 'flag cleared';

  -- Hooks.
  assert not public.account_hook_exists('on_account_linked'), 'no hook installed';
  assert not public.account_hook_exists('nonsense'), 'unknown hook name is false';

  -- Rate-limit store exists.
  insert into public.account_session_calls (subject_hash, at) values ('h', now());

  -- Not readable by clients.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  failed := false;
  begin
    perform 1 from public.account_links;
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  assert failed, 'authenticated must not read account_links';
  set local role anon;
  failed := false;
  begin
    perform 1 from public.account_links;
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  assert failed, 'anon must not read account_links';
  foreach r in array array['authenticated', 'anon'] loop
    foreach fn in array array[
      'public.merge_profiles(gen_random_uuid(), gen_random_uuid())',
      'public.reset_profile_identity_for(gen_random_uuid())',
      'public.account_link_and_merge(''t'', ''s'', gen_random_uuid(), ''{}''::uuid[])',
      'public.account_hook_exists(''on_account_linked'')',
      'public.account_last_active(''{}''::uuid[])',
      'public.account_user_id_by_email(''x'')'] loop
      execute format('set local role %I', r);
      failed := false;
      begin
        execute 'select ' || fn;
      exception when insufficient_privilege then failed := true;
      end;
      reset role;
      assert failed, r || ' must not execute ' || fn;
    end loop;
  end loop;

  raise exception 'ACCOUNTS_TESTS_PASSED';
end $$;
