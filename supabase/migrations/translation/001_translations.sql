-- Translation module: posts, comments and poll option labels translated at
-- publication into the app's declared locales (COMMUNITY_TRANSLATION_LOCALES
-- secret, mirrored by the client's modules.translation.locales), shown in the
-- reader's language by @rocapine/community-ui with a per-item "see original".
--
-- Written only by the service role (translate-one / daily-translation Edge
-- Functions). Readable exactly where the parent row is readable (RLS on
-- posts/comments does the filtering, same pattern as likes). Additive: no
-- core table changes. poll_option_translations is guarded so this module
-- installs on a backend without the polls module.

create table public.post_translations (
  post_id       uuid not null references public.posts(id) on delete cascade,
  locale        text not null,
  source_locale text not null,
  content       text not null,
  engine        text not null,
  created_at    timestamptz not null default now(),
  primary key (post_id, locale)
);
alter table public.post_translations enable row level security;
create policy "post translations readable where post readable"
  on public.post_translations for select to anon, authenticated
  using (exists (select 1 from public.posts p where p.id = post_translations.post_id));
grant select on public.post_translations to anon, authenticated;

create table public.comment_translations (
  comment_id    uuid not null references public.comments(id) on delete cascade,
  locale        text not null,
  source_locale text not null,
  content       text not null,
  engine        text not null,
  created_at    timestamptz not null default now(),
  primary key (comment_id, locale)
);
alter table public.comment_translations enable row level security;
create policy "comment translations readable where comment readable"
  on public.comment_translations for select to anon, authenticated
  using (exists (select 1 from public.comments c where c.id = comment_translations.comment_id));
grant select on public.comment_translations to anon, authenticated;

do $$
begin
  if to_regclass('public.poll_options') is not null then
    create table if not exists public.poll_option_translations (
      option_id uuid not null references public.poll_options(id) on delete cascade,
      locale    text not null,
      content   text not null,
      primary key (option_id, locale)
    );
    alter table public.poll_option_translations enable row level security;
    drop policy if exists "poll option translations readable where option readable"
      on public.poll_option_translations;
    create policy "poll option translations readable where option readable"
      on public.poll_option_translations for select to anon, authenticated
      using (exists (select 1 from public.poll_options o where o.id = poll_option_translations.option_id));
    grant select on public.poll_option_translations to anon, authenticated;
  end if;
end $$;

-- ============ SWEEP HELPER ============
-- Visible items that lack at least one target locale other than their own
-- source language. Items with no translation row at all have an unknown
-- source and are always returned. Service role only.
create or replace function public.items_missing_translations(
  kind text, target_locales text[], max_items int
) returns table (id uuid)
language sql stable security definer set search_path = public as $$
  select x.id from (
    select p.id, p.created_at,
      (select array_agg(t.locale) from public.post_translations t where t.post_id = p.id) as have,
      (select min(t.source_locale) from public.post_translations t where t.post_id = p.id) as src
    from public.posts p where kind = 'post' and p.status = 'visible'
    union all
    select c.id, c.created_at,
      (select array_agg(t.locale) from public.comment_translations t where t.comment_id = c.id) as have,
      (select min(t.source_locale) from public.comment_translations t where t.comment_id = c.id) as src
    from public.comments c where kind = 'comment' and c.status = 'visible'
  ) x
  where x.have is null
     or exists (
       select 1 from unnest(target_locales) l
       where split_part(l, '-', 1) <> x.src and not (l = any (x.have))
     )
  order by x.created_at desc
  limit max_items
$$;
revoke execute on function public.items_missing_translations(text, text[], int) from public, anon, authenticated;
grant execute on function public.items_missing_translations(text, text[], int) to service_role;

-- ============ TRIGGERS ============
create or replace function public.translate_post_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := '__SUPABASE_PROJECT_URL__/functions/v1/translate-one',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer __SUPABASE_ANON_KEY__'),
    body := jsonb_build_object('kind', 'post', 'id', new.id)
  );
  return new;
end; $$;

create or replace function public.translate_comment_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := '__SUPABASE_PROJECT_URL__/functions/v1/translate-one',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer __SUPABASE_ANON_KEY__'),
    body := jsonb_build_object('kind', 'comment', 'id', new.id)
  );
  return new;
end; $$;

drop trigger if exists on_post_published_translate on public.posts;
create trigger on_post_published_translate
  after update of status on public.posts for each row
  when (old.status = 'pending' and new.status = 'visible')
  execute function public.translate_post_webhook();
drop trigger if exists on_post_created_visible_translate on public.posts;
create trigger on_post_created_visible_translate
  after insert on public.posts for each row
  when (new.status = 'visible')
  execute function public.translate_post_webhook();

drop trigger if exists on_comment_published_translate on public.comments;
create trigger on_comment_published_translate
  after update of status on public.comments for each row
  when (old.status = 'pending' and new.status = 'visible')
  execute function public.translate_comment_webhook();
drop trigger if exists on_comment_created_visible_translate on public.comments;
create trigger on_comment_created_visible_translate
  after insert on public.comments for each row
  when (new.status = 'visible')
  execute function public.translate_comment_webhook();

-- ============ CRON ============
-- Daily sweep at 08:30 UTC (after the 08:00 moderation sweep): back-fills the
-- history on first installation, then catches anything translate-one missed.
do $$
begin
  perform cron.schedule(
    'community-translation-sweep',
    '30 8 * * *',
    $cron$
    select net.http_post(
      url := '__SUPABASE_PROJECT_URL__/functions/v1/daily-translation',
      headers := jsonb_build_object('Authorization', 'Bearer __SUPABASE_ANON_KEY__')
    );
    $cron$
  );
exception when others then
  if sqlerrm like '%already exists%' then
    raise notice 'cron job community-translation-sweep already scheduled, skipping';
  else
    raise;
  end if;
end $$;
