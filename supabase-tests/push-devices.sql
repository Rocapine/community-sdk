-- push_devices (push/006_push_devices.sql). Run against a backend with core + push applied:
--   npx supabase db query --linked --yes -f supabase-tests/push-devices.sql
-- Always rolls back by raising at the end: it passed when the error message is exactly
-- PUSH_DEVICES_TESTS_PASSED.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  n int;
  failed boolean;
begin
  insert into auth.users (id) values (a), (b);
  insert into public.push_devices (user_id, device_id, expo_push_token) values
    (a, 'phone', 'ExponentPushToken[a1]'), (a, 'tablet', 'ExponentPushToken[a2]'),
    (b, 'phone', 'ExponentPushToken[b1]');

  -- A device is unique per (user, device_id).
  failed := false;
  begin
    insert into public.push_devices (user_id, device_id, expo_push_token) values (a, 'phone', 'x');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'one row per (user, device)';

  -- As member a: sees only its two rows, can't touch b's, can't insert for b.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from public.push_devices;
  assert n = 2, 'a member reads only its own devices, saw ' || n;
  select count(*) into n from public.push_devices where user_id = b;
  assert n = 0, 'a member cannot read another member''s device';
  update public.push_devices set expo_push_token = 'hijack' where user_id = b;
  delete from public.push_devices where user_id = b;
  failed := false;
  begin
    insert into public.push_devices (user_id, device_id, expo_push_token) values (b, 'tablet', 'x');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a member cannot insert a device for another member';
  update public.push_devices set expo_push_token = 'ExponentPushToken[a3]' where device_id = 'tablet';
  delete from public.push_devices where device_id = 'phone';
  select count(*) into n from public.push_devices;
  assert n = 1, 'a member updates and deletes its own rows';
  reset role;

  select count(*) into n from public.push_devices where user_id = b and expo_push_token = 'ExponentPushToken[b1]';
  assert n = 1, 'the other member''s row is untouched';
  select count(*) into n from public.push_devices where user_id = a and expo_push_token = 'ExponentPushToken[a3]';
  assert n = 1, 'the update went through';

  -- Deleting the profile deletes its devices.
  delete from auth.users where id = b;
  select count(*) into n from public.push_devices where user_id = b;
  assert n = 0, 'devices go with the profile';

  raise exception 'PUSH_DEVICES_TESTS_PASSED';
end $$;
