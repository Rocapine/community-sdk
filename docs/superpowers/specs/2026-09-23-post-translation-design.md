# Automatic translation of posts and comments — design

Date: 2026-09-23. Status: approved in brainstorming, awaiting implementation plan.
Scope: `@rocapine/community-core`, `@rocapine/community-ui`, `@rocapine/community` (CLI) and the
Supabase backend templates. First consumer: Eve's Rhythm (7 locales). Nightward (single locale)
does not enable the module.

## 1. Goal and decisions

Readers see every post, comment and poll in the language of their app, with a per-item toggle back
to the original. Decisions taken during brainstorming (each is a product choice, not an inference):

| Question | Decision |
| --- | --- |
| Default display | Translation shown automatically; discreet "Translated from X · See original" line toggles that one item. No persisted preference. |
| Target languages | The app's declared locales (`modules.translation.locales`), identical on the backend via a secret. No dynamic detection of active locales. |
| Source language | Detected by the model at translation time; never trusted from `profiles.locale`. No translation row is written for the source language. |
| Engine | OpenAI, through the `OPENAI_API_KEY` secret both apps already hold. Model name is a secret with a small default. One structured-output call per item, all target locales at once. |
| When | At publication (status becomes `visible`), asynchronously; a daily sweep backfills the whole history and any item whose translation failed. |
| Pushes and inbox | In the recipient's language (comment push, official-post broadcast, inbox excerpts). |
| Polls | Option labels translated with the post, in the same call. |

Volume baseline (Eve prod, 2026-09-23): ~200 posts and ~400 comments per month, 356 / 198
characters on average; 96% of profiles `en`, 3.7% `es-419`. Cost is not a design constraint.

## 2. Non-goals (v1)

- Searching inside translations (`searchPosts` keeps matching the original text).
- A global "always show originals" preference (extension point: a host adapter, later).
- Real-time delivery of a translation that arrives after the reader loaded the feed (next refetch is fine).
- Translating `username`, topic labels (host i18n) or moderation notices.
- Re-translating existing rows when the prompt or model changes (the `engine` column makes a targeted
  re-run possible later).

## 3. Architecture

Same shape as the other optional modules (push, polls, reaction, inbox):

```
posts/comments status → visible ──trigger (pg_net, anon key)──▶ translate-one ──▶ OpenAI ──▶ *_translations rows
                                                                    ▲
daily-translation (cron) ── items missing a target locale ──────────┘
client select embeds *_translations filtered on the reader locale ──▶ FeedPost.translation / ThreadComment.translation
notify-comment / broadcast-post ── ensureTranslations() ──▶ excerpt in the recipient's locale
```

New module id: `translation`. Installed by the CLI like the others (`--modules ...,translation`),
placed after `inbox` in `MODULE_ORDER`.

## 4. Data model, RLS, triggers (`supabase/migrations/translation/001_translations.sql`)

```sql
create table public.post_translations (
  post_id       uuid not null references public.posts(id) on delete cascade,
  locale        text not null,             -- target locale as declared in the config (es-419, pt-PT…)
  source_locale text not null,             -- detected language of the original, short code (en, es, pt…)
  content       text not null,
  engine        text not null,             -- e.g. "openai:<model>" — allows a targeted re-translation later
  created_at    timestamptz not null default now(),
  primary key (post_id, locale)
);
create table public.comment_translations (… comment_id …, same shape, primary key (comment_id, locale));
create table public.poll_option_translations (
  option_id uuid not null references public.poll_options(id) on delete cascade,
  locale text not null,
  content text not null,
  primary key (option_id, locale)
);
```

- No row is written for a target locale equal to the detected source language.
- `source_locale` lives on every translation row (not on `posts`) so the module stays additive.
- RLS: `select` for `anon, authenticated` only when the parent row is readable by the caller
  (`exists (select 1 from posts p where p.id = post_id)` — RLS on `posts` does the filtering, same
  pattern as `likes`); poll option translations check through `poll_options → posts`. No client write
  grants; only the service role writes.
- Triggers on `posts` and `comments`: `after insert … when (new.status = 'visible')` and
  `after update of status … when (old.status = 'pending' and new.status = 'visible')`, calling
  `translate-one` through `net.http_post` with `{ "kind": "post" | "comment", "id": <uuid> }` and the
  anon key (placeholders `__SUPABASE_PROJECT_URL__` / `__SUPABASE_ANON_KEY__`, same as push).
- `poll_option_translations` is created inside a `do $$ … if to_regclass('public.poll_options') is
  not null …` guard (the same pattern as the inbox module's reaction trigger), so `translation`
  installs cleanly on a backend without `polls`. The CLI warns when `translation` is requested
  without `polls`, only to explain that poll labels won't be translated; nothing breaks.
- The migration also ships `public.items_missing_translations(kind text, target_locales text[], max_items int)`,
  a security-definer helper used by `daily-translation` to list visible posts/comments lacking at
  least one target locale other than their source (see 5.3); execute is granted to the service role only.
- Cron: `community-translation-sweep`, daily at 08:30 UTC (after the 08:00 moderation sweep), calling
  `daily-translation` with the anon key.

## 5. Backend functions

### 5.1 `_shared/translation.ts`

- `TARGET_LOCALES` from the secret `COMMUNITY_TRANSLATION_LOCALES` (comma-separated, e.g.
  `en,es-ES,es-419,it,pl,pt-PT,pt-BR`). Empty/missing → the functions log once and do nothing.
- `TRANSLATION_MODEL` from `COMMUNITY_TRANSLATION_MODEL` (default: a small, cheap OpenAI model,
  fixed in code as the default value; the secret overrides it).
- `TRANSLATION_STYLE` from `COMMUNITY_TRANSLATION_STYLE` (optional free-text voice instruction per
  app, e.g. Eve: informal "tu", feminine audience, faith vocabulary; empty by default).
- `translateItem({ content, pollOptions? })` → one OpenAI request with a JSON schema response:
  `{ source_locale: string, translations: { [locale]: { content: string, options?: string[] } } }`.
  Instructions: detect the language; translate only into target locales whose language differs from
  the source; respect regional variants; keep emojis, line breaks, register and length; never add,
  summarise or moderate. `options` must keep the input order and count.
- `parseTranslationResponse(json, targetLocales, optionCount)` — pure, unit-tested: rejects invalid
  JSON, unknown locales, a source locale outside the expected short-code shape, an `options` array
  whose length differs from the input; drops any translation whose locale language equals the source.
- `ensureTranslations(kind, id)` → reads the row (must be `visible`), returns existing rows when every
  target locale (minus the source) is present, otherwise translates, upserts the missing rows
  (`on conflict (id, locale) do update`) and returns them. Returns `null` on OpenAI/network failure
  without writing anything. Used by `translate-one`, `daily-translation`, `notify-comment`,
  `broadcast-post`.
- `resolveTargetLocale(profileLocale | null)` → exact match in `TARGET_LOCALES`, else first target
  with the same language, else `null`. Shared by the push functions; mirrors core's reader resolver.

### 5.2 `translate-one`

Anon-key reachable (trigger). Reads only `kind` and `id` from the body, re-reads the row, requires
`status = 'visible'`, calls `ensureTranslations`. Idempotent: a duplicate call after the rows exist
makes no API call. Returns `{ status: "ok" | "skipped" | "failed" }`.

### 5.3 `daily-translation`

Selects visible posts and comments that lack at least one target locale other than their source,
through `items_missing_translations(kind, target_locales, max_items)` (section 4), so the check
stays correct when a locale is added to the secret. Batches of 50 per kind, capped per run (default 500
items) to fit the function's time budget; the first runs after installation back-fill the history.
Slack summary only when something failed (`_shared/slack.ts`, no-op without the webhook). Quiet
when there is nothing to do.

### 5.4 Push functions

- `notify-comment`: after the existing eligibility checks, resolves the recipient's target locale
  from `profiles.locale`; calls `ensureTranslations("comment", id)`; if a row exists for that locale,
  the push body uses the translated content for its 140-character excerpt; otherwise (same language,
  no locale, or translation failure) the original — the push is never delayed by a failure, only by a
  successful translation (a few seconds).
- `broadcast-post`: `ensureTranslations("post", id)`, then groups tokens by the recipient's resolved
  target locale (`push_tokens` joined to `profiles.locale`) and sends one Expo batch per group with the
  matching excerpt; recipients without a locale or in the source language get the original.
- `notify-like` / `notify-reaction`: carry no content — unchanged.

### 5.5 Secrets summary

| Secret | Required | Purpose |
| --- | --- | --- |
| `COMMUNITY_TRANSLATION_LOCALES` | yes, module on | Target locales, must equal the client config list |
| `COMMUNITY_TRANSLATION_MODEL` | no | Overrides the default OpenAI model |
| `COMMUNITY_TRANSLATION_STYLE` | no | Per-app voice instruction |
| `OPENAI_API_KEY` | already set | Translation calls |

## 6. Client core

- `CommunityModules.translation: { locales: string[] } | false` (default `false`).
- `readerLocale(cfg): string | null` — `cfg.host.getLocale()` resolved against
  `modules.translation.locales`: exact match, else first declared locale of the same language, else
  `null` (originals only). Pure, unit-tested.
- Selects: when the module is on and a reader locale exists, `buildFeedSelect` gains
  `post_translations(locale, source_locale, content)` and, when polls are on, the nested
  `poll_options(id, idx, label, poll_option_translations(content))`; the query adds the embedded
  filters `.eq("post_translations.locale", locale)` and
  `.eq("poll_options.poll_option_translations.locale", locale)`. `fetchThread` embeds
  `comment_translations(locale, source_locale, content)` the same way. Without the module: byte-identical
  queries (the `poll_options` lesson).
- Models: `FeedPost.text` / `ThreadComment.text` stay the **original**. New
  `translation: { text: string; sourceLocale: string } | null` on both; `FeedPoll.options[i].translatedLabel: string | null`.
  Optimistic posts/comments have `translation: null`.
- Query keys of the feed, user posts, search and thread include the reader locale so a language change
  in the app refetches.
- Inbox: `fetchInbox` collects the `post_id`s of its items and, when the module is on, reads
  `post_translations` for the reader locale in one query; for items whose translation exists it
  replaces `payload.postExcerpt` with the same 140-character excerpt computed on the translated text.
  Custom kinds untouched.
- New event `COMMUNITY_EVENTS.translationToggled` = `community_translation_toggled`,
  props `{ postId | commentId, to: "original" | "translation" }`.

## 7. UI

- `CommunityPost` and the thread's `CommentRow` display `translation.text` when present, else `text`;
  the poll block uses `translatedLabel` when present. Below the body (after the clamp, before the
  footer) a line in `fonts.medium` 12.5 `textFaint`: `t("translation.translatedFrom", { language })` +
  ` · ` + `t("translation.showOriginal")`; toggled state shows `t("translation.original")` +
  ` · ` + `t("translation.showTranslation")`. State is local to the item; toggling emits the event.
- Pure helper `utils/translation.ts`: `displayText(item, showOriginal)`, `toggleLabel(...)`, unit-tested.
- New catalogue keys in all 9 locales: `translation.translatedFrom`, `translation.original`,
  `translation.showOriginal`, `translation.showTranslation`, and `language.<code>` for
  `en, es, pt, it, pl, fr, de` (fallback: the raw code).

## 8. CLI

- `MODULE_ORDER` gains `translation` (last). Templates: `migrations/translation/001_translations.sql`,
  functions `translate-one`, `daily-translation`, plus the modified `notify-comment`, `broadcast-post`,
  `_shared/translation.ts` (the shared file is copied with every function as today).
- `init`/`upgrade` print the new secrets. `upgrade --modules translation` on an existing install
  copies the migration and functions and warns if `polls` is absent (labels not translated).
- `docs/compat.md`: schema version unchanged (additive). Release: core minor, ui minor, cli minor → 0.3.0.

## 9. Testing

- Core vitest: `readerLocale` (exact / same language / none), select construction with and without the
  module and with/without polls, `mapPostRow` / `mapCommentRow` / `buildPoll` with and without
  translation rows, inbox excerpt substitution, query keys.
- UI vitest: `displayText` / `toggleLabel`, catalogue key parity (contract keys), event name.
- Functions: `deno check`; unit tests for `parseTranslationResponse` and `resolveTargetLocale`
  (`deno test`, added to CI alongside the existing steps).
- CLI vitest: module ordering, secrets printout, warning without polls, fixture counts.
- Manual: install on the scratch project (`cozfrhmbjrvotpwjnqmu`) via the CLI, set the secrets, run
  the sweep on the seeded posts, verify on the iPhone simulator with the app in `es-419`: feed, poll,
  thread, toggle, inbox excerpt, and a comment push body (via a second seeded account with a token).

## 10. Rollout and rollback

Order for Eve: publish SDK 0.3.0 → `npx @rocapine/community upgrade --modules translation` →
`supabase db push` (`--include-all` if needed) → `supabase functions deploy translate-one daily-translation
notify-comment broadcast-post` → `supabase secrets set COMMUNITY_TRANSLATION_LOCALES=...` (and STYLE) →
enable `modules.translation` in `lib/community-config.ts` → build. Installed clients are unaffected
(new tables only). Rollback: `modules.translation: false` hides everything client-side; unscheduling
the cron and dropping the two triggers stops the backend without touching data.
