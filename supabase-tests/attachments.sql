-- Attachments module (attachments/001). Run against a backend with it applied:
--   npx supabase db query --remote=<ref> --yes -f supabase-tests/attachments.sql
-- Inserts a few posts, then always rolls back by raising at the end: the run passed
-- when the error message is exactly ATTACHMENTS_TESTS_PASSED.
do $$
declare
  pid uuid;
begin
  select id into pid from public.profiles limit 1;

  -- An attachment still needs text: pushes and inbox rows read an empty post as a photo.
  begin
    insert into public.posts (author_id, content, attachment)
      values (pid, '', '{"type":"verse","id":"43.3.16-17"}');
    assert false, 'an attachment with no text is refused';
  exception when check_violation then null;
  end;

  -- With text too.
  insert into public.posts (author_id, content, attachment)
    values (pid, 'For God so loved the world', '{"type":"verse","id":"43.3.16"}');

  -- Shape: an object with string type and id.
  begin
    insert into public.posts (author_id, content, attachment) values (pid, 'x', '{"type":3,"id":"x"}');
    assert false, 'a non-string type is refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.posts (author_id, content, attachment) values (pid, 'x', '{"type":"verse"}');
    assert false, 'a missing id is refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.posts (author_id, content, attachment) values (pid, 'x', '["verse"]');
    assert false, 'a non-object is refused';
  exception when check_violation then null;
  end;

  -- Size.
  begin
    insert into public.posts (author_id, content, attachment)
      values (pid, 'x', jsonb_build_object('type', 'verse', 'id', repeat('9', 600)));
    assert false, 'a 600-byte attachment is refused';
  exception when check_violation then null;
  end;


  raise exception 'ATTACHMENTS_TESTS_PASSED';
end $$;
