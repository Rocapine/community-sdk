-- community-sdk translation/003_skip_empty.sql (schema v1)
-- Image-only posts and comments (images module) store content = '': there is
-- nothing to translate, so ensureTranslations writes no row for them, and the
-- sweep helper below would re-pick them on every daily run (filling its
-- newest-first window and keeping the chain going). Same function as
-- 001_translations.sql with `content <> ''` added to both inner selects.
-- Idempotent (create or replace); service role only, as before.
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
    from public.posts p where kind = 'post' and p.status = 'visible' and p.content <> ''
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
    from public.comments c where kind = 'comment' and c.status = 'visible' and c.content <> ''
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
