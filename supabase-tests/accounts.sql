-- Account links and profile merge (accounts/001_accounts.sql, accounts/002_merge_and_delete.sql,
-- accounts/003_markers_and_bans.sql).
-- Run against a backend with core applied, after accounts/001, 002 and 003:
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
  s_m uuid := gen_random_uuid(); s_o uuid := gen_random_uuid();
  rec record;
  n int;
  z uuid := gen_random_uuid(); w uuid := gen_random_uuid(); v uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  q uuid := gen_random_uuid(); q2 uuid := gen_random_uuid(); q3 uuid := gen_random_uuid();
  q4 uuid := gen_random_uuid(); q5 uuid := gen_random_uuid();
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid();
  ban_hash text := public.account_ban_hash('test', 'subject-ban');
  failed boolean;
  -- Every "table.column" that merge_profiles moves; a new foreign key to profiles must be added to
  -- merge_profiles AND here.
  handled text[] := array[
    'posts.author_id', 'comments.author_id', 'likes.user_id', 'blocks.blocker_id', 'blocks.blocked_id',
    'reports.reporter_id', 'reports.reported_user_id', 'moderation_actions.target_user_id',
    'post_drafts.author_id', 'notifications.user_id', 'notifications.actor_id',
    'notification_seen.user_id', 'notification_reads.user_id', 'poll_votes.user_id',
    'post_reactions.user_id', 'member_presence.user_id', 'push_tokens.user_id', 'push_devices.user_id',
    'profiles.merged_into']; -- repointed by account_link_and_merge, not merge_profiles
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

  -- Sessions: each has one, o's with a refresh token.
  insert into auth.sessions (id, user_id) values (s_m, m), (s_o, o);
  insert into auth.refresh_tokens (token, user_id, session_id) values ('o-refresh', o::text, s_o);

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
    assert (select count(*) from public.push_devices where user_id = m) = 1, 'o''s devices do not move to m';
    assert not exists (select 1 from public.push_devices where user_id = o), 'o''s devices are deleted';
  end if;
  if to_regclass('public.poll_votes') is not null then
    assert (select count(*) from public.poll_votes where user_id = m) = 1, 'one poll vote kept';
  end if;
  if to_regclass('public.push_tokens') is not null then
    assert (select expo_push_token from public.push_tokens where user_id = m) = 'main', 'main keeps its push token';
  end if;

  assert not exists (select 1 from auth.sessions where user_id = o), 'the merge revokes o''s sessions';
  assert not exists (select 1 from auth.refresh_tokens where token = 'o-refresh'), 'and its refresh tokens (cascade)';
  assert exists (select 1 from auth.sessions where id = s_m), 'main''s session stays';

  assert (select is_banned from public.profiles where id = m), 'a banned other bans main';
  assert not (select is_admin from public.profiles where id = m), 'is_admin is never taken from other';
  assert (select username from public.profiles where id = m) = 'Chosen', 'main with the default name takes the chosen one';
  assert (select bio from public.profiles where id = m) = 'hi', 'and the bio';
  assert (select username_set_by_user from public.profiles where id = m), 'and now counts as chosen';
  assert (select username is not distinct from default_username and bio is null and avatar_url is null and not username_set_by_user
            from public.profiles where id = o), 'the merged-away profile keeps no name, bio or avatar';

  -- Both chosen: main keeps its own.
  perform set_config('community.trusted', 'on', true);
  update public.profiles set username = 'Mine', username_set_by_user = true, bio = 'mine', is_banned = false where id = m;
  update public.profiles set username = 'Theirs', username_set_by_user = true, bio = 'theirs', is_banned = false where id = o;
  perform set_config('community.trusted', '', true);
  perform public.merge_profiles(m, o);
  assert (select username from public.profiles where id = m) = 'Mine', 'both chosen: main keeps its name';
  assert (select bio from public.profiles where id = m) = 'mine', 'both chosen: main keeps its bio';
  assert not (select is_banned from public.profiles where id = m), 'not banned stays not banned';

  -- Legacy push row: main without one takes other's preferences, never other's device token.
  if to_regclass('public.push_tokens') is not null then
    delete from public.push_tokens where user_id in (m, o);
    insert into public.push_tokens (user_id, expo_push_token, notify_likes) values (o, 'other device', false);
    perform public.merge_profiles(m, o);
    assert (select expo_push_token is null and not notify_likes from public.push_tokens where user_id = m),
      'the preferences move, the legacy token does not';
    assert not exists (select 1 from public.push_tokens where expo_push_token = 'other device'),
      'other''s legacy token reaches nobody';
  end if;

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
  update auth.users set is_sso_user = true where id = x;
  assert public.account_user_id_by_email('account+abc@account.invalid') is null, 'an SSO user is never returned';

  -- reset_profile_identity_for: default name back, bio and avatar cleared.
  update public.profiles set default_username = 'Default 1', bio = 'x', avatar_url = 'y' where id = m;
  perform public.reset_profile_identity_for(m);
  assert (select username from public.profiles where id = m) = 'Default 1', 'name reset';
  assert (select bio from public.profiles where id = m) is null, 'bio cleared';
  assert not (select username_set_by_user from public.profiles where id = m), 'flag cleared';

  -- Hooks.
  assert not public.account_hook_exists('on_account_linked'), 'no hook installed';
  assert not public.account_hook_exists('nonsense'), 'unknown hook name is false';

  -- Rate limit: the first call passes, a second within 10 s does not, an older one passes again.
  assert public.account_session_touch('h'), 'first call passes';
  assert public.account_session_touch('h') is null, 'a second call within 10 s is refused';
  update public.account_session_calls set at = now() - interval '11 seconds' where subject_hash = 'h';
  assert public.account_session_touch('h'), 'a call after 10 s passes';

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
      'public.account_delete_profile(gen_random_uuid())',
      'public.account_link_and_merge(''t'', ''s'', gen_random_uuid(), ''{}''::uuid[])',
      'public.account_hook_exists(''on_account_linked'')',
      'public.account_last_active(''{}''::uuid[])',
      'public.account_user_id_by_email(''x'')',
      'public.account_session_touch(''x'')'] loop
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

  -- account_delete_profile: identity reset, push rows and sessions gone; o is the profile.
  update public.profiles set username = 'Custom', username_set_by_user = true, bio = 'hi',
    revenuecat_id = 'rc', amplitude_id = 'amp' where id = o;
  if to_regclass('public.push_tokens') is not null then
    insert into public.push_tokens (user_id, expo_push_token) values (o, 'other') on conflict do nothing;
  end if;
  insert into auth.sessions (id, user_id) values (gen_random_uuid(), o);
  assert exists (select 1 from auth.sessions where user_id = o), 'o has a session';
  -- Badges and streak shown on o's posts (badges/streaks modules, where installed).
  if exists (select 1 from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'badges') then
    update public.profiles set badges = '{"streak": {"since": "2026-01-01T00:00:00Z"}, "bestStreak": {"days": 3}, "month": 4}',
      hidden_badges = '{bestStreak}' where id = o;
    assert (select visible_badges <> '{}' from public.profiles where id = o), 'o shows badges';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'streak_started_at') then
    update public.profiles set streak_started_at = now() - interval '3 days', best_streak_days = 9, show_streak = false where id = o;
  end if;
  perform public.account_delete_profile(o);
  if exists (select 1 from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'badges') then
    assert (select badges = '{}' and hidden_badges = '{}' and visible_badges = '{}' from public.profiles where id = o),
      'delete clears the badges, as on a fresh profile';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'streak_started_at') then
    assert (select streak_started_at is null and best_streak_days is null and show_streak and show_best_streak
              and visible_streak_started_at is null and visible_best_streak_days is null
            from public.profiles where id = o), 'delete clears the streak, as on a fresh profile';
  end if;
  assert (select not username_set_by_user and bio is null from public.profiles where id = o), 'delete resets the identity';
  assert (select revenuecat_id is null and amplitude_id is null from public.profiles where id = o),
    'delete clears the host ids, so no candidates hook adopts the profile again';
  assert not exists (select 1 from auth.sessions where user_id = o), 'delete revokes the sessions';
  if to_regclass('public.push_tokens') is not null then
    assert not exists (select 1 from public.push_tokens where user_id = o), 'delete drops the push token';
  end if;
  if to_regclass('public.push_devices') is not null then
    assert not exists (select 1 from public.push_devices where user_id = o), 'delete drops the push devices';
  end if;

  -- Markers (accounts/003): account_link_and_merge marks each merged profile with its main, and a
  -- profile already merged into it follows. account_delete_profile stamps account_deleted_at.
  insert into auth.users (id) values (z), (w), (v), (u), (q), (q2), (q3), (q4), (q5);
  update public.profiles set merged_into = z where id = w;
  perform public.account_link_and_merge('test', 'subject-1', m, array[z, m]);
  assert (select merged_into from public.profiles where id = z) = m, 'a merged profile points at its main';
  assert (select merged_into from public.profiles where id = w) = m, 'a profile merged into it follows to main';
  assert (select merged_into from public.profiles where id = m) is null, 'main is never marked, even in its own merge list';
  assert (select account_deleted_at is not null from public.profiles where id = o), 'delete stamps account_deleted_at';

  -- A profile merged away or deleted earlier, adopted again as main (candidates hook): both markers
  -- cleared, even when the profile it was merged into is in its own merge list; nobody points at itself.
  insert into auth.users (id) values (r1), (r2);
  update public.profiles set merged_into = r2, account_deleted_at = now() where id = r1;
  perform public.account_link_and_merge('test', 'subject-readopt', r1, array[r2]);
  assert (select merged_into is null and account_deleted_at is null from public.profiles where id = r1),
    're-adopted main loses both markers';
  assert (select merged_into from public.profiles where id = r2) = r1, 'the merged profile points at main';
  assert not exists (select 1 from public.profiles where merged_into = id), 'no profile is merged into itself';

  -- A ban survives account deletion: v is linked and banned, then deleted as account-delete does
  -- (account_delete_profile, then the link goes). Only the hash is kept, never the subject.
  perform public.account_link_and_merge('test', 'subject-ban', v, '{}');
  update public.profiles set is_banned = true where id = v;
  perform public.account_delete_profile(v);
  delete from public.account_links where profile_id = v;
  assert exists (select 1 from public.account_bans where provider = 'test' and subject_hash = ban_hash),
    'a banned deleted account keeps its ban as a hash';
  assert not exists (select 1 from public.account_bans b where b::text like '%subject-ban%'), 'never the subject in clear';
  assert ban_hash <> encode(sha256(convert_to('test:subject-ban', 'UTF8')), 'hex'), 'a keyed hash, not a plain sha256';
  assert (select count(*) from public.account_ban_key) = 1, 'one key';
  perform public.account_link_and_merge('test', 'subject-free', u, '{}');
  perform public.account_delete_profile(u);
  assert not exists (select 1 from public.account_bans where subject_hash = public.account_ban_hash('test', 'subject-free')),
    'a deleted account that was not banned leaves no ban';

  -- The account comes back on a fresh profile: banned, with one moderation action, once.
  assert public.account_link_and_merge('test', 'subject-ban', q, '{}'), 'the account links again';
  assert (select is_banned from public.profiles where id = q), 'a banned account that comes back is banned';
  perform public.account_link_and_merge('test', 'subject-ban', q, '{}');
  assert (select count(*) from public.moderation_actions where target_user_id = q) = 1, 'one moderation action, not one per sign-in';
  assert exists (select 1 from public.moderation_actions where target_user_id = q and action = 'ban'
                   and actor_email = 'account ban' and note = 'banned account came back'), 'the action says why';

  -- Unbanned without account_unban (a plain is_banned = false): a later sign-in does not ban it again.
  update public.profiles set is_banned = false where id = q;
  assert not public.account_link_and_merge('test', 'subject-ban', q, '{}'), 'a later sign-in is not a new link';
  assert not (select is_banned from public.profiles where id = q), 'a later sign-in never undoes an unban';
  assert (select count(*) from public.moderation_actions where target_user_id = q) = 1, 'and writes no new ban action';

  -- Unbanned while linked: the hash goes, the next profile of the account is not banned.
  perform public.account_unban(q);
  assert not exists (select 1 from public.account_bans where subject_hash = ban_hash), 'account_unban drops the hash';
  update public.profiles set is_banned = false where id = q;
  delete from public.account_links where profile_id = q;
  perform public.account_link_and_merge('test', 'subject-ban', q2, '{}');
  assert not (select is_banned from public.profiles where id = q2), 'an unbanned account comes back unbanned';

  -- Banned, deleted, then unbanned from the dashboard (no link left), then back: not banned.
  update public.profiles set is_banned = true where id = q2;
  perform public.account_delete_profile(q2);
  delete from public.account_links where profile_id = q2;
  assert exists (select 1 from public.account_bans where subject_hash = ban_hash), 'banned again on deletion';
  perform public.account_unban(q2);
  assert not exists (select 1 from public.account_bans where subject_hash = ban_hash), 'account_unban finds a deleted profile''s ban';
  perform public.account_link_and_merge('test', 'subject-ban', q3, '{}');
  assert not (select is_banned from public.profiles where id = q3), 'unbanned after deletion, it comes back unbanned';

  -- A stale ban heals: banned and deleted (a row), back banned on q4, unbanned with a plain
  -- is_banned = false (no account_unban), deleted again: the row goes, the next return is not banned.
  update public.profiles set is_banned = true where id = q3;
  perform public.account_delete_profile(q3);
  delete from public.account_links where profile_id = q3;
  perform public.account_link_and_merge('test', 'subject-ban', q4, '{}');
  assert (select is_banned from public.profiles where id = q4), 'back banned on q4';
  update public.profiles set is_banned = false where id = q4;
  assert exists (select 1 from public.account_bans where subject_hash = ban_hash), 'a plain unban leaves the row';
  perform public.account_delete_profile(q4);
  delete from public.account_links where profile_id = q4;
  assert not exists (select 1 from public.account_bans where subject_hash = ban_hash),
    'deleting the unbanned profile drops the stale row';
  perform public.account_link_and_merge('test', 'subject-ban', q5, '{}');
  assert not (select is_banned from public.profiles where id = q5), 'and the account comes back unbanned';

  -- Service role only.
  foreach r in array array['authenticated', 'anon'] loop
    execute format('set local role %I', r);
    failed := false;
    begin
      perform 1 from public.account_bans;
    exception when insufficient_privilege then failed := true;
    end;
    reset role;
    assert failed, r || ' must not read account_bans';
    execute format('set local role %I', r);
    failed := false;
    begin
      perform public.account_unban(gen_random_uuid());
    exception when insufficient_privilege then failed := true;
    end;
    reset role;
    assert failed, r || ' must not execute account_unban';
  end loop;
  -- The key and the hash: no API role, the service role included.
  foreach r in array array['authenticated', 'anon', 'service_role'] loop
    execute format('set local role %I', r);
    failed := false;
    begin
      perform 1 from public.account_ban_key;
    exception when insufficient_privilege then failed := true;
    end;
    reset role;
    assert failed, r || ' must not read account_ban_key';
    execute format('set local role %I', r);
    failed := false;
    begin
      perform public.account_ban_hash('test', 'guess');
    exception when insufficient_privilege then failed := true;
    end;
    reset role;
    assert failed, r || ' must not execute account_ban_hash';
  end loop;

  raise exception 'ACCOUNTS_TESTS_PASSED';
end $$;
