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
  select count(*) into n from public.moderation_actions where action = 'schedule_post' and note = 'draft ' || d || ' unscheduled';
  assert n = 1, 'unschedule note names the draft';
  select count(*) into n from public.moderation_actions where action = 'schedule_post' and note = 'draft ' || d || ' at ' || to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  assert n = 1, 'schedule note names the draft and the time';

  -- Unscheduling a draft with no time and no error is a no-op.
  assert public.schedule_post_draft(d, 3, null, null, 'a@x.co') = 3, 'no-op unschedule returns the current version';
  select * into r from public.post_drafts where id = d;
  assert r.version = 3, 'no-op unschedule keeps the version';
  select count(*) into n from public.moderation_actions
    where action = 'schedule_post' and target_user_id = pid and actor_email = 'a@x.co';
  assert n = 2, 'no-op unschedule is not logged';

  -- With a time, the zone must be a known one; without, it is ignored.
  begin
    perform public.schedule_post_draft(d, 3, t, null, 'a@x.co');
    assert false, 'a null zone schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  begin
    perform public.schedule_post_draft(d, 3, t, 'Mars/Olympus', 'a@x.co');
    assert false, 'an unknown zone schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  begin
    perform public.schedule_post_draft(d, 3, t, 'ABC-3', 'a@x.co');
    assert false, 'a POSIX zone schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;

  -- Unscheduling a failed draft clears the error.
  update public.post_drafts set publish_at = now() - interval '1 minute', publish_error = 'missed', failed_at = now()
    where id = d;
  v := public.schedule_post_draft(d, 3, null, 'Mars/Olympus', 'a@x.co');
  assert v = 4, 'unscheduling a failed draft bumps the version';
  select * into r from public.post_drafts where id = d;
  assert r.publish_at is null and r.publish_error is null and r.failed_at is null, 'unscheduling clears the error';

  -- Invalid drafts use the publish codes.
  insert into public.post_drafts (author_id, content, created_by, updated_by)
    values (pid, '', 't@x', 't@x') returning id into d;
  begin
    perform public.schedule_post_draft(d, 1, t, 'Europe/Paris', 'a@x.co');
    assert false, 'an empty draft schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_content', sqlerrm;
  end;
  insert into public.post_drafts (author_id, content, created_by, updated_by)
    values (pid, 'no topic', 't@x', 't@x') returning id into d;
  begin
    perform public.schedule_post_draft(d, 1, t, 'Europe/Paris', 'a@x.co');
    assert false, 'a draft without a topic schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_topic', sqlerrm;
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
  insert into public.post_drafts (author_id, topic, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'first', now() - interval '3 minutes', 'cron@x.co', 't@x', 't@x');
  insert into public.post_drafts (author_id, content, pin, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'middle', true, now() - interval '2 minutes', 'cron@x.co', 't@x', 't@x') returning id into d;
  insert into public.post_drafts (author_id, topic, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'last', now() - interval '1 minute', 'cron@x.co', 't@x', 't@x');
  assert public.publish_due_post_drafts() = 2, 'two of three publish';
  select count(*) into n from public.posts where author_id = pid and content in ('first', 'last');
  assert n = 2, 'the valid drafts became posts';
  select * into r from public.post_drafts where id = d;
  assert r.publish_at is not null and r.publish_error = 'not_admin' and r.failed_at is not null,
    'the invalid draft keeps its time and records the error';
  assert public.publish_due_post_drafts() = 0, 'a failed draft is skipped';
  select * into r from public.post_drafts where id = d;
  assert r.publish_error = 'not_admin' and r.publish_at is not null, 'a failed draft keeps its error and time';
  select count(*) into n from public.posts where author_id = pid and content = 'middle';
  assert n = 0, 'a failed draft gets no post on the next run';
  update public.profiles set is_admin = true where id = pid;

  -- Late rule: 31 minutes past is missed, 29 minutes past still goes out.
  delete from public.post_drafts where publish_at is not null;
  insert into public.post_drafts (author_id, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'too-late', now() - interval '31 minutes', 'cron@x.co', 't@x', 't@x') returning id into d;
  insert into public.post_drafts (author_id, topic, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'just-in-time', now() - interval '29 minutes', 'cron@x.co', 't@x', 't@x');
  assert public.publish_due_post_drafts() = 1, 'only the 29-minute draft publishes';
  select * into r from public.post_drafts where id = d;
  assert r.publish_error = 'missed' and r.failed_at is not null, 'the 31-minute draft is missed';
  select count(*) into n from public.posts where author_id = pid and content = 'too-late';
  assert n = 0, 'a missed draft makes no post';
  select count(*) into n from public.posts where author_id = pid and content = 'just-in-time';
  assert n = 1, 'a draft 29 minutes late publishes';

  -- A due draft without a topic does not go out; the next one does.
  delete from public.post_drafts where publish_at is not null;
  insert into public.post_drafts (author_id, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'no-topic', now() - interval '2 minutes', 'cron@x.co', 't@x', 't@x') returning id into d;
  insert into public.post_drafts (author_id, topic, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'after-no-topic', now() - interval '1 minute', 'cron@x.co', 't@x', 't@x');
  assert public.publish_due_post_drafts() = 1, 'only the draft with a topic publishes';
  select * into r from public.post_drafts where id = d;
  assert r.publish_error = 'invalid_topic' and r.failed_at is not null, 'the draft without a topic records invalid_topic';
  select count(*) into n from public.posts where author_id = pid and content = 'no-topic';
  assert n = 0, 'a draft without a topic makes no post';
  select count(*) into n from public.posts where author_id = pid and content = 'after-no-topic';
  assert n = 1, 'the next due draft still publishes';

  -- A due draft with an error already set is skipped.
  delete from public.post_drafts where publish_at is not null;
  insert into public.post_drafts (author_id, content, publish_at, scheduled_by, publish_error, failed_at, created_by, updated_by)
    values (pid, 'errored', now() - interval '1 minute', 'cron@x.co', 'invalid_poll', now(), 't@x', 't@x');
  assert public.publish_due_post_drafts() = 0, 'an errored draft is skipped';

  -- A non-P0001 error is stored cut to 200 characters (a trigger on posts provokes it).
  delete from public.post_drafts where publish_at is not null;
  create function public.t_boom() returns trigger language plpgsql as
    $f$ begin raise exception using errcode = '23514', message = repeat('x', 300); end $f$;
  create trigger t_boom before insert on public.posts for each row execute function public.t_boom();
  insert into public.post_drafts (author_id, topic, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'boom', now() - interval '1 minute', 'cron@x.co', 't@x', 't@x') returning id into d;
  assert public.publish_due_post_drafts() = 0, 'a draft whose insert fails is not counted';
  select * into r from public.post_drafts where id = d;
  assert r.publish_error = repeat('x', 200), 'a non-P0001 error is stored cut to 200 characters';
  drop trigger t_boom on public.posts;
  drop function public.t_boom();

  -- A transient error (deadlock here) leaves the draft untouched for the next run; the rest still go out.
  delete from public.post_drafts where publish_at is not null;
  create function public.t_transient() returns trigger language plpgsql as
    $f$ begin if new.content = 'transient' then raise exception using errcode = '40P01', message = 'deadlock detected'; end if; return new; end $f$;
  create trigger t_transient before insert on public.posts for each row execute function public.t_transient();
  insert into public.post_drafts (author_id, topic, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'transient', now() - interval '2 minutes', 'cron@x.co', 't@x', 't@x') returning id into d;
  insert into public.post_drafts (author_id, topic, content, publish_at, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'beside-transient', now() - interval '1 minute', 'cron@x.co', 't@x', 't@x');
  assert public.publish_due_post_drafts() = 1, 'only the draft that did not deadlock publishes';
  select * into r from public.post_drafts where id = d;
  assert r.publish_error is null and r.failed_at is null and r.publish_at is not null, 'a transient error leaves the draft untouched';
  select count(*) into n from public.posts where author_id = pid and content = 'transient';
  assert n = 0, 'a transient error makes no post';
  select count(*) into n from public.posts where author_id = pid and content = 'beside-transient';
  assert n = 1, 'the next draft in the same run still publishes';
  drop trigger t_transient on public.posts;
  drop function public.t_transient();
  assert public.publish_due_post_drafts() = 1, 'the next run publishes the retried draft';
  select count(*) into n from public.posts where author_id = pid and content = 'transient';
  assert n = 1, 'the retried draft became a post';

  -- Event window: topic_from / topic_until bound the local publish date, [from, until).
  delete from public.post_drafts where publish_at is not null;
  insert into public.post_drafts (author_id, topic, content, topic_from, topic_until, created_by, updated_by)
    values (pid, 'general', 'event', current_date + 10, current_date + 20, 't@x', 't@x') returning id into d;
  t := (current_date + 15)::timestamp at time zone 'UTC' + interval '12 hours';
  v := public.schedule_post_draft(d, 1, t, 'UTC', 'a@x.co');
  assert v = 2, 'a time inside the window schedules';
  begin
    perform public.schedule_post_draft(d, 2, (current_date + 5)::timestamp at time zone 'UTC' + interval '12 hours', 'UTC', 'a@x.co');
    assert false, 'a time before the window schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'topic_closed', sqlerrm;
  end;
  begin
    perform public.schedule_post_draft(d, 2, (current_date + 20)::timestamp at time zone 'UTC' + interval '12 hours', 'UTC', 'a@x.co');
    assert false, 'the until date schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'topic_closed', sqlerrm;
  end;
  v := public.schedule_post_draft(d, 2, (current_date + 10)::timestamp at time zone 'UTC' + interval '1 minute', 'UTC', 'a@x.co');
  assert v = 3, 'the from date itself is inside the window';
  -- The date is the one in the draft's zone: 23:30 UTC on the last day is already the until date in Tokyo.
  begin
    perform public.schedule_post_draft(d, 3, (current_date + 19)::timestamp at time zone 'UTC' + interval '23 hours 30 minutes', 'Asia/Tokyo', 'a@x.co');
    assert false, 'a Tokyo time past the until date schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'topic_closed', sqlerrm;
  end;
  v := public.schedule_post_draft(d, 3, (current_date + 19)::timestamp at time zone 'UTC' + interval '23 hours 30 minutes', 'UTC', 'a@x.co');
  assert v = 4, 'the same instant in UTC is the last day of the window';
  -- Only a lower or an upper bound works too; null bounds behave as before (covered above).
  update public.post_drafts set topic_from = null, topic_until = current_date + 1 where id = d;
  begin
    perform public.schedule_post_draft(d, 4, (current_date + 15)::timestamp at time zone 'UTC' + interval '12 hours', 'UTC', 'a@x.co');
    assert false, 'a time past an upper-only bound schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'topic_closed', sqlerrm;
  end;
  update public.post_drafts set topic_from = current_date + 10, topic_until = null where id = d;
  begin
    perform public.schedule_post_draft(d, 4, (current_date + 9)::timestamp at time zone 'UTC' + interval '12 hours', 'UTC', 'a@x.co');
    assert false, 'a time before a lower-only bound schedules';
  exception when sqlstate 'P0001' then assert sqlerrm = 'topic_closed', sqlerrm;
  end;
  assert public.schedule_post_draft(d, 4, (current_date + 10)::timestamp at time zone 'UTC' + interval '1 minute', 'UTC', 'a@x.co') = 5,
    'the from date passes a lower-only bound';
  -- Publishing checks the window now, not the stored date: a scheduled draft whose stored date is
  -- outside the window goes out manually while the topic is open today.
  delete from public.post_drafts where publish_at is not null;
  insert into public.post_drafts (author_id, topic, content, publish_at, publish_tz, scheduled_by, topic_from, topic_until, created_by, updated_by)
    values (pid, 'general', 'stale-date', now() + interval '100 days', 'UTC', 'a@x.co', current_date - 1, current_date + 2, 't@x', 't@x') returning id into d;
  assert public.publish_post_draft(d, 1, 'a@x.co') is not null, 'a manual publish checks the window now';
  insert into public.post_drafts (author_id, topic, content, publish_at, publish_tz, scheduled_by, publish_error, failed_at, topic_from, topic_until, created_by, updated_by)
    values (pid, 'general', 'was-closed', now() - interval '2 days', 'UTC', 'a@x.co', 'topic_closed', now(), current_date - 1, current_date + 2, 't@x', 't@x') returning id into d;
  assert public.publish_post_draft(d, 1, 'a@x.co') is not null, 'a draft that failed topic_closed publishes once the topic is open';
  insert into public.post_drafts (author_id, topic, content, publish_at, publish_tz, scheduled_by, topic_until, created_by, updated_by)
    values (pid, 'general', 'now-closed', now() + interval '1 day', 'UTC', 'a@x.co', (now() at time zone 'UTC')::date, 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 'a@x.co');
    assert false, 'a manual publish after the window ended';
  exception when sqlstate 'P0001' then assert sqlerrm = 'topic_closed', sqlerrm;
  end;
  -- The cron marks a due draft whose window closed.
  delete from public.post_drafts where publish_at is not null;
  insert into public.post_drafts (author_id, topic, content, publish_at, publish_tz, scheduled_by, topic_until, created_by, updated_by)
    values (pid, 'general', 'closed', now() - interval '1 minute', 'UTC', 'cron@x.co', current_date - 5, 't@x', 't@x') returning id into d;
  insert into public.post_drafts (author_id, topic, content, publish_at, publish_tz, scheduled_by, topic_from, topic_until, created_by, updated_by)
    values (pid, 'general', 'open', now() - interval '1 minute', 'UTC', 'cron@x.co', current_date - 5, current_date + 5, 't@x', 't@x');
  assert public.publish_due_post_drafts() = 1, 'only the draft inside its window publishes';
  select * into r from public.post_drafts where id = d;
  assert r.publish_error = 'topic_closed' and r.failed_at is not null, 'a draft whose window closed records topic_closed';

  -- Planned time vs armed (p_arm). A planned time needs no complete post and is not armed.
  delete from public.post_drafts where publish_at is not null;
  insert into public.post_drafts (author_id, content, created_by, updated_by)
    values (pid, '', 't@x', 't@x') returning id into d; -- no topic, no text
  t := now() + interval '2 hours';
  v := public.schedule_post_draft(d, 1, t, 'Europe/Paris', 'p@x.co', false);
  assert v = 2, 'planning bumps the version';
  select * into r from public.post_drafts where id = d;
  assert r.publish_at = t and r.publish_tz = 'Europe/Paris' and r.scheduled_by is null, 'a planned time is not armed';
  select count(*) into n from public.moderation_actions where action = 'schedule_post' and actor_email = 'p@x.co';
  assert n = 0, 'planning an unarmed draft is not logged';
  v := public.schedule_post_draft(d, 2, t + interval '1 hour', 'UTC', 'p@x.co', false);
  assert v = 3, 'changing a planned time works';
  select count(*) into n from public.moderation_actions where action = 'schedule_post' and actor_email = 'p@x.co';
  assert n = 0, 'changing a planned time is not logged';
  -- The cron ignores a due unarmed draft, whatever its age.
  update public.post_drafts set publish_at = now() - interval '1 minute' where id = d;
  insert into public.post_drafts (author_id, topic, content, publish_at, created_by, updated_by)
    values (pid, 'general', 'unarmed-due', now() - interval '1 hour', 't@x', 't@x');
  assert public.publish_due_post_drafts() = 0, 'the cron ignores unarmed drafts';
  select * into r from public.post_drafts where id = d;
  assert r.publish_error is null and r.failed_at is null and r.publish_at is not null, 'an unarmed draft is left alone';
  select count(*) into n from public.post_drafts where content = 'unarmed-due' and publish_error is null;
  assert n = 1, 'an unarmed draft past 30 minutes is not marked missed';
  update public.post_drafts set publish_at = t + interval '1 hour', publish_tz = 'UTC' where id = d;
  -- Arming an incomplete draft fails with its code and changes nothing.
  begin
    perform public.schedule_post_draft(d, 3, t, 'Europe/Paris', 'p@x.co');
    assert false, 'an incomplete draft is armed';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_content', sqlerrm;
  end;
  begin
    perform public.schedule_post_draft(d, 3, t, 'Europe/Paris', 'p@x.co', true);
    assert false, 'an incomplete draft is armed (explicit)';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_content', sqlerrm;
  end;
  -- Complete it, arm it (logged), then disarm keeping the time (logged), then clear.
  update public.post_drafts set topic = 'general', content = 'planned' where id = d;
  v := public.schedule_post_draft(d, 3, t, 'Europe/Paris', 'p@x.co');
  assert v = 4, 'arming a complete draft works';
  select * into r from public.post_drafts where id = d;
  assert r.publish_at = t and r.scheduled_by = 'p@x.co', 'armed: time kept and scheduled_by set';
  select count(*) into n from public.moderation_actions where action = 'schedule_post' and actor_email = 'p@x.co'
    and note = 'draft ' || d || ' at ' || to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  assert n = 1, 'arming is logged';
  v := public.schedule_post_draft(d, 4, t + interval '1 hour', 'Europe/Paris', 'p@x.co');
  assert v = 5, 'an armed time change works';
  select count(*) into n from public.moderation_actions where action = 'schedule_post' and actor_email = 'p@x.co';
  assert n = 2, 'an armed time change is logged';
  v := public.schedule_post_draft(d, 5, t + interval '1 hour', 'Europe/Paris', 'p@x.co', false);
  assert v = 6, 'disarming works';
  select * into r from public.post_drafts where id = d;
  assert r.publish_at = t + interval '1 hour' and r.publish_tz = 'Europe/Paris' and r.scheduled_by is null, 'disarm keeps the planned time';
  select count(*) into n from public.moderation_actions where action = 'schedule_post' and actor_email = 'p@x.co'
    and note = 'draft ' || d || ' unscheduled';
  assert n = 1, 'disarming is logged';
  -- Disarming an invalid draft is fine too: planning checks no content.
  update public.post_drafts set content = '' where id = d;
  assert public.schedule_post_draft(d, 6, t, 'Europe/Paris', 'p@x.co', false) = 7, 'planning ignores the content';
  v := public.schedule_post_draft(d, 7, null, null, 'p@x.co', false);
  assert v = 8, 'clearing a planned time bumps the version';
  select * into r from public.post_drafts where id = d;
  assert r.publish_at is null and r.publish_tz is null and r.scheduled_by is null, 'clear removes the time';
  assert public.schedule_post_draft(d, 8, null, null, 'p@x.co', false) = 8, 'clearing a clear draft is a no-op';
  -- Clearing an armed draft disarms and logs.
  update public.post_drafts set content = 'again' where id = d;
  v := public.schedule_post_draft(d, 8, t, 'UTC', 'p@x.co');
  v := public.schedule_post_draft(d, v, null, null, 'p@x.co');
  select * into r from public.post_drafts where id = d;
  assert r.publish_at is null and r.scheduled_by is null, 'clearing an armed draft disarms it';
  select count(*) into n from public.moderation_actions where action = 'schedule_post' and actor_email = 'p@x.co'
    and note = 'draft ' || d || ' unscheduled';
  assert n = 2, 'clearing an armed draft is logged';
  -- Bad zone or time: invalid_time in both modes.
  begin
    perform public.schedule_post_draft(d, v, t, 'Mars/Olympus', 'p@x.co', false);
    assert false, 'planning with a bad zone';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  begin
    perform public.schedule_post_draft(d, v, t, null, 'p@x.co', false);
    assert false, 'planning with a null zone';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  begin
    perform public.schedule_post_draft(d, v, now() - interval '1 minute', 'UTC', 'p@x.co', false);
    assert false, 'planning a past time';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  begin
    perform public.schedule_post_draft(d, v, now() + interval '2 years', 'UTC', 'p@x.co', false);
    assert false, 'planning two years ahead';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  begin
    perform public.schedule_post_draft(d, v, now() + interval '2 years', 'UTC', 'p@x.co', true);
    assert false, 'arming two years ahead';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  -- The event window applies to a planned time.
  update public.post_drafts set topic_from = current_date + 10, topic_until = current_date + 20 where id = d;
  begin
    perform public.schedule_post_draft(d, v, (current_date + 5)::timestamp at time zone 'UTC' + interval '12 hours', 'UTC', 'p@x.co', false);
    assert false, 'planning before the window';
  exception when sqlstate 'P0001' then assert sqlerrm = 'topic_closed', sqlerrm;
  end;
  assert public.schedule_post_draft(d, v, (current_date + 15)::timestamp at time zone 'UTC' + interval '12 hours', 'UTC', 'p@x.co', false) = v + 1,
    'planning inside the window works';

  -- Unschedule keeps the time without re-checking it: armed and past, and missed.
  delete from public.post_drafts where publish_at is not null;
  insert into public.post_drafts (author_id, topic, content, publish_at, publish_tz, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'past-armed', now() - interval '2 days', 'Europe/Paris', 'u@x.co', 't@x', 't@x') returning id into d;
  v := public.schedule_post_draft(d, 1, (select publish_at from public.post_drafts where id = d), 'Europe/Paris', 'u@x.co', false);
  assert v = 2, 'unscheduling a past armed draft works';
  select * into r from public.post_drafts where id = d;
  assert r.scheduled_by is null and r.publish_at < now() and r.publish_tz = 'Europe/Paris', 'the past time is kept, disarmed';
  select count(*) into n from public.moderation_actions where action = 'schedule_post' and note = 'draft ' || d || ' unscheduled';
  assert n = 1, 'unscheduling is logged';
  begin
    perform public.schedule_post_draft(d, 2, now() - interval '1 hour', 'Europe/Paris', 'u@x.co', false);
    assert false, 'a new past planned time';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_time', sqlerrm;
  end;
  insert into public.post_drafts (author_id, topic, content, publish_at, publish_tz, scheduled_by, publish_error, failed_at, created_by, updated_by)
    values (pid, 'general', 'missed-one', now() - interval '3 hours', 'UTC', 'u@x.co', 'missed', now(), 't@x', 't@x') returning id into d;
  v := public.schedule_post_draft(d, 1, (select publish_at from public.post_drafts where id = d), 'UTC', 'u@x.co', false);
  select * into r from public.post_drafts where id = d;
  assert v = 2 and r.scheduled_by is null and r.publish_error is null and r.failed_at is null and r.publish_at < now(),
    'unscheduling a missed draft keeps the time and clears the error';

  -- Keep path polish: a stale caller, a millisecond-rounded time, a repeated unschedule, the old signature.
  insert into public.post_drafts (author_id, topic, content, publish_at, publish_tz, scheduled_by, created_by, updated_by)
    values (pid, 'general', 'keep-armed', now() + interval '1 day' + interval '123456 microseconds', 'UTC', 'k@x.co', 't@x', 't@x') returning id into d;
  select * into r from public.post_drafts where id = d;
  begin
    perform public.schedule_post_draft(d, 99, r.publish_at, 'UTC', 'k@x.co', false);
    assert false, 'a stale unschedule';
  exception when sqlstate 'P0001' then assert sqlerrm = 'draft_changed', sqlerrm;
  end;
  v := public.schedule_post_draft(d, 1, date_trunc('milliseconds', r.publish_at), 'UTC', 'k@x.co', false);
  assert v = 2, 'a millisecond-rounded time still unschedules';
  select * into r from public.post_drafts where id = d;
  assert r.scheduled_by is null and r.publish_at is not null, 'disarmed, time kept';
  assert public.schedule_post_draft(d, 2, r.publish_at, 'UTC', 'k@x.co', false) = 2, 'repeating the same planned time is a no-op';
  select * into r from public.post_drafts where id = d;
  assert r.version = 2, 'the no-op keeps the version';
  assert to_regprocedure('public.schedule_post_draft(uuid,int,timestamptz,text,text)') is null, 'the 5-argument function is gone';

  -- Not callable by clients or service_role; the job exists and runs the function every minute.
  set local role authenticated;
  begin
    perform public.publish_due_post_drafts();
    assert false, 'a client runs the cron function';
  exception when insufficient_privilege then null;
  end;
  reset role;
  assert has_function_privilege('service_role', 'public.schedule_post_draft(uuid,int,timestamptz,text,text,boolean)', 'execute'),
    'service_role can schedule';
  assert not has_function_privilege('authenticated', 'public.schedule_post_draft(uuid,int,timestamptz,text,text,boolean)', 'execute'),
    'clients cannot schedule';
  assert not has_function_privilege('service_role', 'public.publish_due_post_drafts()', 'execute'),
    'service_role cannot run the cron function';
  assert has_function_privilege((select username from cron.job where jobname = 'post-drafts-publish'),
    'public.publish_due_post_drafts()', 'execute'), 'the cron job user can run the cron function';
  assert exists (select 1 from cron.job where jobname = 'post-drafts-publish' and schedule = '* * * * *'
    and command like '%publish_due_post_drafts()%'), 'the cron job runs publish_due_post_drafts every minute';

  raise exception 'SCHEDULED_POSTS_TESTS_PASSED';
end $$;
