-- community-sdk groups/006_review_fixes.sql (schema v1)
-- Review fixes to groups/001 and groups/005 (same signatures, grants kept):
--  - edit_group: at most 5 edits per group per hour ('rate_limited'), each one sending
--    the group back through moderation. In-app admins are exempt. The edits of the last
--    hour are logged in `group_edits` (older rows are dropped on the next edit);
--  - messaging_images_unreferenced: a file an open report points at (the reported
--    message's image, now or in an earlier version; a reported group's live pictures,
--    `group-images/<group>/…`, and the pending one it waits on)
--    is never listed, so the daily sweep keeps the evidence until the report is resolved.
-- Requires messaging/001 and groups/001…005. Idempotent.

-- ============ EDIT COOLDOWN ============
create table if not exists public.group_edits (
  group_id uuid not null references public.groups(conversation_id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists group_edits_group_idx on public.group_edits (group_id, at);
alter table public.group_edits enable row level security;
revoke all on public.group_edits from public, anon, authenticated;

-- Writes the pending values (null keeps a field as it is); the live values stay shown
-- until moderation approves. Resubmitting clears the rejected fields.
create or replace function public.edit_group(p_group uuid, p_name text, p_description text, p_image_path text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_name text;
  v_description text;
  v_admin boolean := public.current_user_admin();
begin
  perform public.group_assert_kind(p_group);
  if not public.can_manage_group(p_group) then
    raise exception 'forbidden';
  end if;
  if public.current_user_banned() then
    raise exception 'banned';
  end if;
  select o_name, o_description into v_name, v_description
  from public.group_check_fields(p_name, p_description, p_image_path);
  if p_name is not null and v_name is null then
    raise exception 'name_required';
  end if;
  if p_description is not null and v_description is null then
    raise exception 'description_required';
  end if;
  if not v_admin then
    -- One edit at a time per group, so parallel calls can't all pass the count.
    perform pg_advisory_xact_lock(hashtextextended('group_edit:' || p_group::text, 0));
    delete from group_edits where group_id = p_group and at <= now() - interval '1 hour';
    if (select count(*) from group_edits where group_id = p_group) >= 5 then
      raise exception 'rate_limited';
    end if;
  end if;
  update groups set
    pending_name = coalesce(v_name, pending_name),
    pending_description = coalesce(v_description, pending_description),
    pending_image_path = coalesce(p_image_path, pending_image_path),
    rejected_fields = '{}'
  where conversation_id = p_group and status <> 'deleted';
  if not found then
    raise exception 'not_found';
  end if;
  if not v_admin then
    insert into group_edits (group_id) values (p_group);
  end if;
end;
$$;

-- ============ STORAGE SWEEP ============
-- groups/005's rules, plus: nothing an open report points at.
create or replace function public.messaging_images_unreferenced(p_limit int default 500)
returns table (bucket text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  with deleted_groups as (
    select g.conversation_id::text as id from public.groups g where g.status = 'deleted'
  ),
  reported_groups as (
    select r.group_id::text as id from public.reports r
    where r.status = 'open' and r.group_id is not null
  ),
  reported_pending as (
    select g.pending_image_path as path from public.groups g
    join reported_groups rg on rg.id = g.conversation_id::text
    where g.pending_image_path is not null
  ),
  reported_images as (
    select m.image_path as path from public.reports r
    join public.messages m on m.id = r.message_id
    where r.status = 'open' and m.image_path is not null
    union
    select v.image_path from public.reports r
    join public.message_versions v on v.message_id = r.message_id
    where r.status = 'open' and v.image_path is not null
  )
  select o.bucket_id, o.name
  from storage.objects o
  where ((
      o.bucket_id = 'group-images'
      and not exists (select 1 from public.groups g
                      where g.image_path = o.name and g.status <> 'deleted')
      and (o.created_at < now() - interval '1 day'
           or split_part(o.name, '/', 1) in (select id from deleted_groups))
      and split_part(o.name, '/', 1) not in (select id from reported_groups)
    ) or (
      o.bucket_id = 'group-images-pending'
      and o.created_at < now() - interval '1 day'
      and not exists (select 1 from public.groups g
                      where g.pending_image_path = o.name and g.status <> 'deleted')
      and o.name not in (select path from reported_pending)
    ) or (
      o.bucket_id = 'message-images'
      and (
        split_part(o.name, '/', 1) in (select id from deleted_groups)
        or (o.created_at < now() - interval '1 day'
            and not exists (select 1 from public.messages m where m.image_path = o.name)
            and not exists (select 1 from public.message_versions v where v.image_path = o.name))
      )
      and o.name not in (select path from reported_images)
    ))
  order by o.created_at
  limit p_limit;
$$;

revoke execute on function public.messaging_images_unreferenced(int) from public, anon, authenticated;
