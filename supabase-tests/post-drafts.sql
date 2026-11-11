-- Post drafts (core/014_post_drafts.sql).
-- Run against a backend with core, polls, images and attachments applied:
--   npx supabase db query --remote=<ref> --yes -f supabase-tests/post-drafts.sql
-- It changes one profile and publishes a few posts, then always rolls back by
-- raising at the end: the run passed when the error message is exactly
-- POST_DRAFTS_TESTS_PASSED.
do $$
declare
  pid uuid;
  d uuid;
  post uuid;
  p record;
  n int;
  idxs smallint[];
  img text;
  labels text[];
begin
  select id into pid from public.profiles where not is_banned limit 1;
  update public.profiles set is_house = true, is_admin = true where id = pid;

  -- Clients never see drafts.
  set local role authenticated;
  begin
    perform 1 from public.post_drafts;
    assert false, 'a client cannot read drafts';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- A plain draft, pinned and notified.
  insert into public.post_drafts (author_id, topic, content, pin, notify, created_by, updated_by)
    values (pid, 'general', 'hello', true, true, 't@x', 't@x') returning id into d;
  post := public.publish_post_draft(d, 1, 't@x');
  assert post is not null, 'publish returns the post id';
  select * into p from public.posts where id = post;
  assert p.status = 'visible', 'published visible';
  assert p.moderated_at is not null, 'published moderated';
  assert p.pinned_at is not null, 'pin pins';
  assert p.broadcast_requested, 'notify asks for the broadcast';
  assert p.author_id = pid and p.topic = 'general' and p.content = 'hello', 'post copies the draft';
  assert not exists (select 1 from public.post_drafts where id = d), 'the draft is gone';
  select count(*) into n from public.moderation_actions
    where action = 'publish_post' and target_post_id = post and target_user_id = pid and actor_email = 't@x';
  assert n = 1, 'publish is logged';

  -- A poll draft.
  insert into public.post_drafts (author_id, topic, content, poll_options, created_by, updated_by)
    values (pid, 'general', 'which?', '{a,b,c}', 't@x', 't@x') returning id into d;
  post := public.publish_post_draft(d, 1, 't@x');
  select array_agg(idx order by idx) into idxs from public.poll_options where post_id = post;
  assert idxs = '{0,1,2}'::smallint[], 'three options, idx 0..2';
  select array_agg(label order by idx) into labels from public.poll_options where post_id = post;
  assert labels = '{a,b,c}'::text[], 'option labels copied in order';
  select * into p from public.posts where id = post;
  assert p.pinned_at is null and not p.broadcast_requested, 'no pin, no notify by default';

  -- An attachment draft.
  insert into public.post_drafts (author_id, topic, content, attachment, created_by, updated_by)
    values (pid, 'general', 'read this', '{"type":"verse","id":"43.3.16"}', 't@x', 't@x') returning id into d;
  post := public.publish_post_draft(d, 1, 't@x');
  select * into p from public.posts where id = post;
  assert p.attachment = '{"type":"verse","id":"43.3.16"}'::jsonb, 'attachment copied';

  -- An image draft in the author's folder.
  insert into public.post_drafts (author_id, topic, content, image_path, image_width, image_height, created_by, updated_by)
    values (pid, 'general', 'look', pid::text || '/pic.jpg', 640, 480, 't@x', 't@x') returning id into d;
  post := public.publish_post_draft(d, 1, 't@x');
  select * into p from public.posts where id = post;
  assert p.image_path = pid::text || '/pic.jpg' and p.image_width = 640 and p.image_height = 480, 'image copied';

  -- An image-only draft (no text).
  insert into public.post_drafts (author_id, topic, content, image_path, image_width, image_height, created_by, updated_by)
    values (pid, 'general', '', pid::text || '/only.jpg', 640, 480, 't@x', 't@x') returning id into d;
  post := public.publish_post_draft(d, 1, 't@x');
  select * into p from public.posts where id = post;
  assert p.content = '' and p.image_path = pid::text || '/only.jpg', 'image-only publishes';

  -- Refusals: each case expects one error code.
  insert into public.post_drafts (author_id, content, version, created_by, updated_by)
    values (pid, 'x', 2, 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 't@x');
    assert false, 'stale version publishes';
  exception when sqlstate 'P0001' then assert sqlerrm = 'draft_changed', sqlerrm;
  end;

  begin
    perform public.publish_post_draft(d, null, 't@x');
    assert false, 'a null version publishes';
  exception when sqlstate 'P0001' then assert sqlerrm = 'draft_changed', sqlerrm;
  end;

  begin
    perform public.publish_post_draft(gen_random_uuid(), 1, 't@x');
    assert false, 'unknown draft publishes';
  exception when sqlstate 'P0001' then assert sqlerrm = 'draft_not_found', sqlerrm;
  end;

  update public.profiles set is_admin = false where id = pid;
  insert into public.post_drafts (author_id, content, pin, created_by, updated_by)
    values (pid, 'x', true, 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 't@x');
    assert false, 'a non-admin pins';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_admin', sqlerrm;
  end;
  insert into public.post_drafts (author_id, content, notify, created_by, updated_by)
    values (pid, 'x', true, 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 't@x');
    assert false, 'a non-admin notifies everyone';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_admin', sqlerrm;
  end;
  update public.profiles set is_admin = true where id = pid;

  update public.profiles set is_house = false where id = pid;
  insert into public.post_drafts (author_id, content, created_by, updated_by)
    values (pid, 'x', 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 't@x');
    assert false, 'a member account publishes';
  exception when sqlstate 'P0001' then assert sqlerrm = 'not_a_team_account', sqlerrm;
  end;
  update public.profiles set is_house = true where id = pid;

  insert into public.post_drafts (author_id, content, created_by, updated_by)
    values (pid, '', 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 't@x');
    assert false, 'empty content without an image publishes';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_content', sqlerrm;
  end;

  insert into public.post_drafts (author_id, content, image_path, image_width, image_height, created_by, updated_by)
    values (pid, 'x', gen_random_uuid()::text || '/pic.jpg', 640, 480, 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 't@x');
    assert false, 'an image outside the author folder publishes';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_content', sqlerrm;
  end;

  insert into public.post_drafts (author_id, content, poll_options, created_by, updated_by)
    values (pid, 'x', '{a}', 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 't@x');
    assert false, 'a one-option poll publishes';
  exception when sqlstate 'P0001' then assert sqlerrm = 'invalid_poll', sqlerrm;
  end;

  insert into public.post_drafts (author_id, content, poll_options, attachment, created_by, updated_by)
    values (pid, 'x', '{a,b}', '{"type":"verse","id":"1"}', 't@x', 't@x') returning id into d;
  begin
    perform public.publish_post_draft(d, 1, 't@x');
    assert false, 'poll and attachment publish together';
  exception when sqlstate 'P0001' then assert sqlerrm = 'one_extra_only', sqlerrm;
  end;

  -- The nightly sweep keeps the image of a draft (images/002_draft_images.sql).
  insert into storage.objects (bucket_id, name, created_at)
    values ('post-images', gen_random_uuid()::text || '/x.jpg', now() - interval '2 days')
    returning name into img;
  insert into public.post_drafts (author_id, content, image_path, image_width, image_height, created_by, updated_by)
    values (pid, 'x', img, 640, 480, 't@x', 't@x') returning id into d;
  assert not exists (select 1 from public.post_images_unreferenced(1000) u where u = img),
    'the sweep keeps a draft image';
  delete from public.post_drafts where id = d;
  assert exists (select 1 from public.post_images_unreferenced(1000) u where u = img),
    'the sweep takes the image once the draft is gone';

  raise exception 'POST_DRAFTS_TESTS_PASSED';
end $$;
