-- community-sdk inbox/001_inbox.sql (schema v1)
-- Community SDK — inbox module (OPTIONAL): a notification-center inbox for
-- actor -> recipient events (like / comment / reaction, plus any custom
-- service-role kind a host app writes itself — see the `kind` column note
-- below). Official-account posts are NOT fanned out per user: they are
-- unioned straight from posts in list_notifications() so a broadcast post
-- shows up for everyone without a write per recipient. Read state is one
-- seen_at marker per user (opening the center marks everything read), not
-- per-row read_at. Rows are written by SQL triggers so the inbox fills
-- independently of any push pipeline and of push permission.
--
-- Ported from a host app's two-migration notification-center feature,
-- merged into one file; this ships the FINAL form (the later revision's
-- list_notifications(), which unions ALL visible posts by an is_official
-- profile regardless of topic, supersedes the earlier topic-scoped version —
-- there is no intermediate "topic = news only" state to replay).
--
-- Dependencies: core module tables (public.posts, public.profiles,
-- public.likes, public.comments, public.blocks) — the core module must be
-- installed first. The reaction-kind trigger additionally depends on the
-- reaction module's public.post_reactions table; that trigger is created
-- inside a guarded DO block (`if to_regclass('public.post_reactions') is not
-- null then ...`) so this module installs cleanly without the reaction
-- module — likes/comments notifications work either way.
--
-- `kind` is intentionally an UNCONSTRAINED text column (no CHECK), unlike
-- the source migration this was ported from: a host's own backend (e.g. a
-- support/help-desk integration) may write custom kinds via service role
-- (spec §6), and this module must not need a schema change to allow that.

create extension if not exists pg_cron;

-- ============ NOTIFICATIONS ============
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Unconstrained on purpose — see header note. Built-in kinds emitted by
  -- this module: 'like', 'comment', 'reaction', 'official_post' (the last is
  -- synthesized by list_notifications(), never stored as a row).
  kind text not null,
  actor_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Owner-only read; writes happen only via the security-definer triggers
-- below (and, optionally, service-role inserts from a host's own backend for
-- custom kinds).
create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());

-- "Everything up to seen_at is read". Upserted by the client when the center
-- opens; both the stored rows and the unioned official posts compare
-- against it.
create table public.notification_seen (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.notification_seen enable row level security;

create policy "read own seen" on public.notification_seen
  for select to authenticated using (user_id = auth.uid());
create policy "insert own seen" on public.notification_seen
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own seen" on public.notification_seen
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ TRIGGERS ============
-- Same skip rules throughout: never notify yourself, never notify a
-- recipient who blocked the actor.

create or replace function public.inbox_on_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid;
begin
  select author_id into recipient from posts where id = new.post_id;
  if recipient is null or recipient = new.user_id then return new; end if;
  if exists (select 1 from blocks where blocker_id = recipient and blocked_id = new.user_id) then
    return new;
  end if;
  begin
    insert into notifications (user_id, kind, actor_id, post_id)
    values (recipient, 'like', new.user_id, new.post_id);
  exception when others then null; -- the inbox must never break a like
  end;
  return new;
end; $$;

create trigger on_like_inbox
  after insert on public.likes
  for each row execute function public.inbox_on_like();

-- Unlike retracts the inbox entry (also keeps like/unlike toggling from
-- accumulating duplicate rows).
create or replace function public.inbox_on_unlike()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    delete from notifications
    where kind = 'like' and post_id = old.post_id and actor_id = old.user_id;
  exception when others then null; -- the inbox must never break an unlike
  end;
  return old;
end; $$;

create trigger on_unlike_inbox
  after delete on public.likes
  for each row execute function public.inbox_on_unlike();

-- Comments enter as 'pending' and publish on moderation; mirror the push
-- module's own comment triggers: fire on pending -> visible, and on direct
-- visible inserts (dashboard replies).
create or replace function public.inbox_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid;
begin
  select author_id into recipient from posts where id = new.post_id;
  if recipient is null or recipient = new.author_id then return new; end if;
  if exists (select 1 from blocks where blocker_id = recipient and blocked_id = new.author_id) then
    return new;
  end if;
  begin
    insert into notifications (user_id, kind, actor_id, post_id)
    values (recipient, 'comment', new.author_id, new.post_id);
  exception when others then null; -- the inbox must never break a comment
  end;
  return new;
end; $$;

create trigger on_comment_published_inbox
  after update on public.comments
  for each row
  when (old.status = 'pending' and new.status = 'visible')
  execute function public.inbox_on_comment();

create trigger on_comment_created_visible_inbox
  after insert on public.comments
  for each row
  when (new.status = 'visible')
  execute function public.inbox_on_comment();

-- Reaction inbox entries (reaction module's post_reactions -> 'reaction'
-- kind). The function is safe to create unconditionally — it only reads
-- core tables (posts, blocks) and writes notifications — but the trigger
-- itself must target public.post_reactions, so its creation is guarded.
create or replace function public.inbox_on_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid;
begin
  select author_id into recipient from posts where id = new.post_id;
  if recipient is null or recipient = new.user_id then return new; end if;
  if exists (select 1 from blocks where blocker_id = recipient and blocked_id = new.user_id) then
    return new;
  end if;
  begin
    insert into notifications (user_id, kind, actor_id, post_id)
    values (recipient, 'reaction', new.user_id, new.post_id);
  exception when others then null; -- the inbox must never break a reaction
  end;
  return new;
end; $$;

-- Guarded: only wire the trigger if the reaction module's table exists, so
-- the inbox module installs standalone without the reaction module.
do $$
begin
  if to_regclass('public.post_reactions') is not null then
    drop trigger if exists on_reaction_inbox on public.post_reactions;
    create trigger on_reaction_inbox
      after insert on public.post_reactions
      for each row execute function public.inbox_on_reaction();
  end if;
end $$;

-- ============ READ API ============
-- The center's single read path. Stored rows for me (minus rows whose post
-- was since hidden/deleted) unioned with recent posts by official accounts
-- (any topic — a broadcast push is topic-agnostic, so the inbox must be
-- too), newest first. SECURITY DEFINER to join profiles/posts across RLS.
create or replace function public.list_notifications(p_limit int default 50)
returns table (
  id uuid,
  kind text,
  actor_id uuid,
  actor_username text,
  post_id uuid,
  post_excerpt text,
  created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  (
    select n.id, n.kind, n.actor_id, pr.username, n.post_id,
           left(p.content, 140), n.created_at
    from notifications n
    left join profiles pr on pr.id = n.actor_id
    left join posts p on p.id = n.post_id
    where n.user_id = auth.uid()
      and (n.post_id is null or p.status in ('visible', 'pending'))
  )
  union all
  (
    select p.id, 'official_post', p.author_id, pr.username, p.id,
           left(p.content, 140), p.created_at
    from posts p
    join profiles pr on pr.id = p.author_id
    where p.status = 'visible' and pr.is_official
      and p.author_id <> auth.uid()
      and p.created_at > now() - interval '90 days'
  )
  order by created_at desc
  limit p_limit;
$$;

revoke execute on function public.list_notifications(int) from public, anon;
grant execute on function public.list_notifications(int) to authenticated;

-- Retention: the official-posts union already stops at 90 days; keep stored
-- rows symmetric.
do $$
begin
  perform cron.schedule(
    'notifications-purge', '15 3 * * *',
    $cron$ delete from public.notifications where created_at < now() - interval '90 days'; $cron$
  );
exception when others then
  if sqlerrm like '%already exists%' then
    raise notice 'cron job notifications-purge already scheduled, skipping';
  else
    raise;
  end if;
end;
$$;
