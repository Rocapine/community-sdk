-- Translation module: posts, comments and poll option labels translated at
-- publication into the app's declared locales (COMMUNITY_TRANSLATION_LOCALES
-- secret, mirrored by the client's modules.translation.locales), shown in the
-- reader's language by @rocapine/community-ui with a per-item "see original".
--
-- Written only by the service role (translate-one / daily-translation Edge
-- Functions). Readable by authenticated users where the parent row is
-- readable (RLS on posts/comments does the filtering, same pattern as
-- likes). Additive: no core table changes. poll_option_translations is
-- guarded so this module installs on a backend without the polls module.
--
-- The translate webhooks, their triggers and the daily sweep cron live in
-- translation/002_webhooks.sql (they read the project URL / anon key from the
-- settings seeded via core/000_settings.sql).
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
  on public.post_translations for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_translations.post_id));
grant select on public.post_translations to authenticated;

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
  on public.comment_translations for select to authenticated
  using (exists (select 1 from public.comments c where c.id = comment_translations.comment_id));
grant select on public.comment_translations to authenticated;

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
      on public.poll_option_translations for select to authenticated
      using (exists (select 1 from public.poll_options o where o.id = poll_option_translations.option_id));
    grant select on public.poll_option_translations to authenticated;
  end if;
end $$;

-- ============ SWEEP HELPER ============
-- Visible items that lack at least one target locale other than their own
-- source language. Marker rows are not translations: 'source' (the detected
-- source had nothing to translate) and 'attempt' (a translation claim, deleted
-- on success). Items with no row at all have an unknown source and are always
-- returned; an item with an 'attempt' younger than 6 h is skipped (in flight,
-- or failed recently — retried once it ages out). Service role only.
create or replace function public.items_missing_translations(
  kind text, target_locales text[], max_items int
) returns table (id uuid)
language sql stable security definer set search_path = public as $$
  select x.id from (
    select p.id, p.created_at,
      exists (select 1 from public.post_translations t where t.post_id = p.id) as has_any,
      (select array_agg(t.locale) filter (where t.locale not in ('source', 'attempt'))
         from public.post_translations t where t.post_id = p.id) as have,
      (select min(t.source_locale) filter (where t.locale <> 'attempt')
         from public.post_translations t where t.post_id = p.id) as src,
      exists (select 1 from public.post_translations t
               where t.post_id = p.id and t.locale = 'attempt'
                 and t.created_at > now() - interval '6 hours') as fresh_attempt
    from public.posts p where kind = 'post' and p.status = 'visible'
    union all
    select c.id, c.created_at,
      exists (select 1 from public.comment_translations t where t.comment_id = c.id) as has_any,
      (select array_agg(t.locale) filter (where t.locale not in ('source', 'attempt'))
         from public.comment_translations t where t.comment_id = c.id) as have,
      (select min(t.source_locale) filter (where t.locale <> 'attempt')
         from public.comment_translations t where t.comment_id = c.id) as src,
      exists (select 1 from public.comment_translations t
               where t.comment_id = c.id and t.locale = 'attempt'
                 and t.created_at > now() - interval '6 hours') as fresh_attempt
    from public.comments c where kind = 'comment' and c.status = 'visible'
  ) x
  where not x.fresh_attempt
    and (not x.has_any
      or exists (
        select 1 from unnest(target_locales) l
        -- `is distinct from`: src is null when the only row is a stale attempt
        -- (a failed try), and that item must be retried.
        where split_part(l, '-', 1) is distinct from x.src
          and not (l = any (coalesce(x.have, '{}')))
      ))
  order by x.created_at desc
  limit max_items
$$;
revoke execute on function public.items_missing_translations(text, text[], int) from public, anon, authenticated;
grant execute on function public.items_missing_translations(text, text[], int) to service_role;
