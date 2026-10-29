-- Reply notifications and per-item read state.
--
-- Additive: installed app versions keep reading the same RPC and the
-- `notification_seen` watermark; a new `reply` kind shows on them through their
-- custom-row fallback (or not at all), and `notification_reads` is only
-- written by apps that mark items read one by one.

-- ============ REPLIES ============
-- Replaces inbox_on_comment (001_inbox.sql), same triggers (pending -> visible,
-- and direct visible inserts). A reply notifies the author of the comment it
-- answers ('reply'); the post author still gets 'comment', unless they are
-- that same person (one row, the more specific one). Self-events and blocked
-- actors never notify. Needs core/010_comment_threads.sql (comments.parent_id).
create or replace function public.inbox_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  post_author uuid;
  parent_author uuid;
begin
  select author_id into post_author from posts where id = new.post_id;
  if new.parent_id is not null then
    select author_id into parent_author from comments where id = new.parent_id;
  end if;

  if parent_author is not null and parent_author <> new.author_id
     and not exists (
       select 1 from blocks where blocker_id = parent_author and blocked_id = new.author_id
     ) then
    begin
      insert into notifications (user_id, kind, actor_id, post_id)
      values (parent_author, 'reply', new.author_id, new.post_id);
    exception when others then null; -- the inbox must never break a comment
    end;
  end if;

  if post_author is not null and post_author <> new.author_id
     and post_author is distinct from parent_author
     and not exists (
       select 1 from blocks where blocker_id = post_author and blocked_id = new.author_id
     ) then
    begin
      insert into notifications (user_id, kind, actor_id, post_id)
      values (post_author, 'comment', new.author_id, new.post_id);
    exception when others then null;
    end;
  end if;
  return new;
end; $$;

-- ============ PER-ITEM READS ============
-- For apps that mark an item read when it is tapped (the SDK's `readMode:
-- "tap"`): an item is read when it is older than the `notification_seen`
-- watermark ("mark all as read" moves it) or listed here. `item_id` is the id
-- `list_notifications` returns: a notification's id, or an official post's id.
create table if not exists public.notification_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.notification_reads enable row level security;

drop policy if exists "read own reads" on public.notification_reads;
create policy "read own reads" on public.notification_reads
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "insert own reads" on public.notification_reads;
create policy "insert own reads" on public.notification_reads
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "delete own reads" on public.notification_reads;
create policy "delete own reads" on public.notification_reads
  for delete to authenticated using (user_id = auth.uid());

revoke all on table public.notification_reads from anon, authenticated;
grant select, insert, delete on table public.notification_reads to authenticated;

-- Same retention as the notifications themselves.
do $$
begin
  perform cron.schedule(
    'notification-reads-purge', '20 3 * * *',
    $cron$ delete from public.notification_reads where read_at < now() - interval '90 days'; $cron$
  );
exception when others then
  if sqlerrm like '%already exists%' then
    raise notice 'cron job notification-reads-purge already scheduled, skipping';
  else
    raise;
  end if;
end;
$$;
