-- Scheduled posts, schedule part (core/015_scheduled_posts.sql).
-- Run against a backend with core, polls, images and attachments applied, after 015:
--   supabase db query --linked --project-ref <ref> --yes -f supabase-tests/scheduled-posts.sql
-- It changes one profile and a few drafts, then always rolls back by raising at
-- the end: the run passed when the error message is exactly SCHEDULED_POSTS_TESTS_PASSED.
do $$
declare
  pid uuid;
  d uuid;
  v int;
  t timestamptz;
  r record;
  n int;
begin
  select id into pid from public.profiles where not is_banned limit 1;
  update public.profiles set is_house = true, is_admin = true where id = pid;

  -- A valid draft scheduled one hour ahead.
  insert into public.post_drafts (author_id, topic, content, created_by, updated_by, publish_error, failed_at)
    values (pid, 'general', 'later', 't@x', 't@x', 'missed', now()) returning id into d;
  t := now() + interval '1 hour';
  v := public.schedule_post_draft(d, 1, t, 'Europe/Paris', 'a@x.co');
  assert v = 2, 'schedule returns version + 1';
  select * into r from public.post_drafts where id = d;
  assert r.publish_at = t and r.publish_tz = 'Europe/Paris' and r.scheduled_by = 'a@x.co', 'schedule columns set';
  assert r.publish_error is null and r.failed_at is null, 'scheduling clears the error';
  assert r.version = 2 and r.updated_by = 'a@x.co', 'version and updated_by bumped';
  select count(*) into n from public.moderation_actions
    where action = 'schedule_post' and target_user_id = pid and actor_email = 'a@x.co';
  assert n = 1, 'schedule is logged once';

  -- Reschedule (stale version refused, then ok).
  begin
    perform public.schedule_post_draft(d, 1, t, 'Europe/Paris', 'a@x.co');
    assert false, 'stale version schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'draft_changed', sqlerrm;
  end;
  begin
    perform public.schedule_post_draft(gen_random_uuid(), 1, t, 'Europe/Paris', 'a@x.co');
    assert false, 'unknown draft schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'draft_not_found', sqlerrm;
  end;

  -- Time window.
  begin
    perform public.schedule_post_draft(d, 2, now() - interval '1 minute', 'Europe/Paris', 'a@x.co');
    assert false, 'a past time schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  begin
    perform public.schedule_post_draft(d, 2, now() + interval '2 years', 'Europe/Paris', 'a@x.co');
    assert false, 'a time two years ahead schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;

  -- Unschedule.
  v := public.schedule_post_draft(d, 2, null, null, 'a@x.co');
  assert v = 3, 'unschedule bumps the version';
  select * into r from public.post_drafts where id = d;
  assert r.publish_at is null and r.publish_tz is null and r.scheduled_by is null, 'unschedule clears the columns';
  select count(*) into n from public.moderation_actions
    where action = 'schedule_post' and target_user_id = pid and actor_email = 'a@x.co';
  assert n = 2, 'unschedule is logged';

  -- Invalid drafts use the publish codes.
  insert into public.post_drafts (author_id, content, created_by, updated_by)
    values (pid, '', 't@x', 't@x') returning id into d;
  begin
    perform public.schedule_post_draft(d, 1, t, 'Europe/Paris', 'a@x.co');
    assert false, 'an empty draft schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_content', sqlerrm;
  end;

  update public.profiles set is_admin = false where id = pid;
  insert into public.post_drafts (author_id, content, pin, created_by, updated_by)
    values (pid, 'x', true, 't@x', 't@x') returning id into d;
  begin
    perform public.schedule_post_draft(d, 1, t, 'Europe/Paris', 'a@x.co');
    assert false, 'a non-admin schedules a pin';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_admin', sqlerrm;
  end;
  update public.profiles set is_admin = true where id = pid;

  -- Clients and anon cannot call the new functions.
  set local role authenticated;
  begin
    perform public.schedule_post_draft(gen_random_uuid(), 1, t, 'Europe/Paris', 'a@x.co');
    assert false, 'a client schedules';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.check_post_draft(null::public.post_drafts);
    assert false, 'a client runs the check';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- publish_post_draft still behaves as in 014, through check_post_draft.
  insert into public.post_drafts (author_id, topic, content, created_by, updated_by)
    values (pid, 'general', 'hello', 't@x', 't@x') returning id into d;
  assert public.publish_post_draft(d, 1, 't@x') is not null, 'publish still works';
  insert into public.post_drafts (author_id, content, poll_options, created_by, updated_by)
    values (pid, 'x', '{a}', 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 't@x');
    assert false, 'a one-option poll publishes';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_poll', sqlerrm;
  end;

  -- The cron function. Start from a clean schedule (rolled back with everything else).
  delete from public.post_drafts where publish_at is not null;

  -- A draft due a minute ago is published, logged for scheduled_by, and counted.
  insert into public.post_drafts (author_id, topic, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'due-now', now() - interval '1 minute', 'cron@x.co', 't@x', 't@x') returning id into d;
  insert into public.post_drafts (author_id, topic, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'due-later', now() + interval '5 minutes', 'cron@x.co', 't@x', 't@x');
  assert public.publish_due_post_drafts() = 1, 'one due draft is published';
  select count(*) into n from public.posts where author_id = pid and content = 'due-now';
  assert n = 1, 'the due draft became a post';
  select count(*) into n from public.post_drafts where id = d;
  assert n = 0, 'the published draft is gone';
  select count(*) into n from public.moderation_actions
    where action = 'publish_post' and actor_email = 'cron@x.co' and target_user_id = pid;
  assert n = 1, 'publish is logged for scheduled_by';
  select count(*) into n from public.post_drafts where content = 'due-later' and publish_error is null;
  assert n = 1, 'a draft due in 5 minutes is untouched';
  assert public.publish_due_post_drafts() = 0, 'a second call publishes nothing';

  -- Three due drafts, the middle one invalid: two post, one keeps its time and gets the error.
  delete from public.post_drafts where publish_at is not null;
  update public.profiles set is_admin = false where id = pid;
  insert into public.post_drafts (author_id, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'first', now() - interval '3 minutes', 'cron@x.co', 't@x', 't@x');
  insert into public.post_drafts (author_id, content, pin, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'middle', true, now() - interval '2 minutes', 'cron@x.co', 't@x', 't@x') returning id into d;
  insert into public.post_drafts (author_id, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'last', now() - interval '1 minute', 'cron@x.co', 't@x', 't@x');
  assert public.publish_due_post_drafts() = 2, 'two of three publish';
  select count(*) into n from public.posts where author_id = pid and content in ('first', 'last');
  assert n = 2, 'the valid drafts became posts';
  select * into r from public.post_drafts where id = d;
  assert r.publish_at is not null and r.publish_error = 'not_admin' and r.failed_at is not null,
    'the invalid draft keeps its time and records the error';
  assert public.publish_due_post_drafts() = 0, 'a failed draft is skipped';
  select * into r from public.post_drafts where id = d;
  assert r.publish_error = 'not_admin', 'a failed draft is unchanged by the next run';
  update public.profiles set is_admin = true where id = pid;

  -- Late rule: 31 minutes past is missed, 29 minutes past still goes out.
  delete from public.post_drafts where publish_at is not null;
  insert into public.post_drafts (author_id, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'too-late', now() - interval '31 minutes', 'cron@x.co', 't@x', 't@x') returning id into d;
  insert into public.post_drafts (author_id, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'just-in-time', now() - interval '29 minutes', 'cron@x.co', 't@x', 't@x');
  assert public.publish_due_post_drafts() = 1, 'only the 29-minute draft publishes';
  select * into r from public.post_drafts where id = d;
  assert r.publish_error = 'missed' and r.failed_at is not null, 'the 31-minute draft is missed';
  select count(*) into n from public.posts where author_id = pid and content = 'too-late';
  assert n = 0, 'a missed draft makes no post';
  select count(*) into n from public.posts where author_id = pid and content = 'just-in-time';
  assert n = 1, 'a draft 29 minutes late publishes';

  -- A due draft with an error already set is skipped.
  delete from public.post_drafts where publish_at is not null;
  insert into public.post_drafts (author_id, content, publish_at, scheduled_by, publish_error, failed_at, created_by, updated_by)
    values (pid, 'errored', now() - interval '1 minute', 'cron@x.co', 'invalid_poll', now(), 't@x', 't@x');
  assert public.publish_due_post_drafts() = 0, 'an errored draft is skipped';

  -- Not callable by clients; the job exists.
  set local role authenticated;
  begin
    perform public.publish_due_post_drafts();
    assert false, 'a client runs the cron function';
  exception when insufficient_privilege then null;
  end;
  reset role;
  assert exists (select 1 from cron.job where jobname = 'post-drafts-publish'), 'the cron job exists';

  raise exception 'SCHEDULED_POSTS_TESTS_PASSED';
end $$;
