# Backend runbook

Everything ops-facing about running the Community SDK's Supabase backend:
secrets, anonymous sign-ins, the `db push` flow, and how to verify the
scheduled jobs actually landed. Successor to an internal reference app's
`docs/community-setup.md` runbook.

## 1. Anonymous sign-ins (manual, no migration does this)

Every community identity is an anonymous Supabase auth session — nothing
works without this enabled.

Dashboard: Authentication → Sign In / Up → toggle "Allow anonymous
sign-ins".

CLI equivalent, via `supabase/config.toml`:

```toml
[auth]
enable_anonymous_sign_ins = true
```

```bash
supabase config push
```

Verify: `curl -s -X POST https://<ref>.supabase.co/auth/v1/signup -H "apikey: <anon-key>" -d '{}'`
should return a session (not an error about anonymous sign-ins being
disabled).

## 2. `db push` flow

```bash
npx @rocapine/community init --modules ...   # or `upgrade` / `adopt`
supabase link --project-ref <ref>
supabase db push
```

`init`/`upgrade` re-prefix every migration with a fresh timestamp at copy
time (so ordering across modules stays correct regardless of install order)
and substitute the `__SUPABASE_PROJECT_URL__` / `__SUPABASE_ANON_KEY__`
placeholders that four migrations carry
(`core/003_moderation.sql`, `push/002_triggers.sql`,
`reaction/001_reactions.sql`, `translation/001_translations.sql` — each
schedules a `pg_cron` job or trigger that calls back into this same project
via `pg_net`). A migration with an
unsubstituted placeholder fails loudly at `db push` (a `DO` block re-checks
this at push time, in addition to the CLI's own pre-write check), rather
than silently pushing and failing later at cron/webhook runtime.

Never renumber or hand-edit an already-applied migration; a new behavior is
always a new migration file, added via `npx @rocapine/community upgrade`.
Adding a whole new module (e.g. translation) to an already-initialized
backend: `npx @rocapine/community upgrade --add-modules translation`.

## 3. Edge Function secrets

```bash
supabase secrets set OPENAI_API_KEY=sk-... SLACK_WEBHOOK_URL=https://hooks.slack.com/... \
  COMMUNITY_APP_NAME="My App" COMMUNITY_FALLBACK_NAME="Someone" \
  COMMUNITY_PUSH_COPY='{"reaction.one":{"en":"{name} sent you support"}}' \
  MODERATION_SCORE_THRESHOLD=0.5 MODERATION_EXCLUDED_CATEGORIES=sexual \
  EXPO_ACCESS_TOKEN=...
supabase functions deploy
```

| Secret                                                             | Default                              | Required?                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Used by                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                                   | none                                 | **Required.** Missing ⇒ the affected function throws at module load (`assertModerationConfigured()`) — a hard, immediate failure, not a silent degrade.                                                                                                                                                                                                                                                                                                                                 | `moderate-one`, `daily-moderation`, `update-profile`                                                          |
| `SLACK_WEBHOOK_URL`                                                | none                                 | Optional. Unset ⇒ `report-to-slack` and `daily-moderation`'s summary post become logged no-ops (`_shared/slack.ts` logs and returns instead of posting).                                                                                                                                                                                                                                                                                                                                | `report-to-slack`, `daily-moderation`                                                                         |
| `COMMUNITY_APP_NAME`                                               | `"Community"`                        | Optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `broadcast-post` — push title fallback for an official post whose author has no username set                  |
| `COMMUNITY_PUSH_COPY`                                              | _(built-in neutral copy, 9 locales)_ | Optional JSON: per-locale, per-key override of every push string — `fallbackName`, `comment.title`, `like.one`, `like.many`, `reaction.one`, `reaction.many` — with `{name}`/`{count}` placeholders; a `*.many` value can be a `{one, few, many, other}` object picked by the recipient locale's CLDR plural category. This is how an app keeps its own voice ("prayed for you 🙏", a gendered fallback name…) without forking the functions. See `supabase/functions/_shared/copy.ts`. | `notify-comment`, `notify-like`, `notify-reaction`                                                            |
| `COMMUNITY_FALLBACK_NAME`                                          | `"Someone"`                          | Optional legacy single string (every locale); `COMMUNITY_PUSH_COPY.fallbackName` wins over it. Should match `CommunityConfig.anonymousAuthorFallback` on the client so pushes and UI agree.                                                                                                                                                                                                                                                                                             | `notify-comment`, `notify-like`, `notify-reaction` — actor-name fallback when the acting user has no username |
| `COMMUNITY_REACTION_PUSH_TEXT`                                     | `"{name} is thinking of you"`        | Optional legacy single string for the single-reactor case (every locale); `COMMUNITY_PUSH_COPY["reaction.one"]` wins over it.                                                                                                                                                                                                                                                                                                                                                           | `notify-reaction`                                                                                             |
| `MODERATION_SCORE_THRESHOLD`                                       | `0.5`                                | Optional. Raw OpenAI moderation score at or above which a category is hidden even when OpenAI's own boolean flag is false (catches under-scored insults/harassment, including other languages).                                                                                                                                                                                                                                                                                         | `_shared/moderation.ts` (all moderating functions)                                                            |
| `MODERATION_EXCLUDED_CATEGORIES`                                   | `""` (none excluded)                 | Optional, comma-separated. Removes listed categories from the score-threshold check only — OpenAI's own boolean flag for that category still applies regardless. **Example (Eve's Rhythm, a menstrual-health app):** `MODERATION_EXCLUDED_CATEGORIES=sexual` lets legitimate intimacy/fertility discussion through the score check, while OpenAI's own `sexual`/`sexual/minors` boolean flags still hide clearly explicit content.                                                      | `_shared/moderation.ts`                                                                                       |
| `EXPO_ACCESS_TOKEN`                                                | none                                 | Optional — only needed for an Expo project with Enhanced Security.                                                                                                                                                                                                                                                                                                                                                                                                                      | `_shared/push.ts` (push module)                                                                               |
| `COMMUNITY_TRANSLATION_LOCALES`                                    | none                                 | **Required with the translation module.** Comma-separated target locales, e.g. `en,es-ES,es-419,it,pl,pt-PT,pt-BR` — must equal the client's `modules.translation.locales`.                                                                                                                                                                                                                                                                                                             | `translate-one`, `daily-translation`, `notify-comment`, `broadcast-post`                                      |
| `COMMUNITY_TRANSLATION_MODEL`                                      | `gpt-5-mini`                         | Optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `translate-one`, `daily-translation`                                                                          |
| `COMMUNITY_TRANSLATION_STYLE`                                      | none                                 | Optional per-app voice instruction appended to the translation prompt.                                                                                                                                                                                                                                                                                                                                                                                                                  | `translate-one`, `daily-translation`                                                                          |
| `COMMUNITY_TRANSLATION_SWEEP_BATCH`                                | `250`                                | Optional test/cost knob: items fetched per kind (post/comment) per `daily-translation` run. A small value (e.g. `2`) forces the self-chain on a small backlog, which is how the chain is exercised on a scratch project.                                                                                                                                                                                                                                                                | `daily-translation`                                                                                           |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | —                                    | Platform-provided automatically; never set these yourself.                                                                                                                                                                                                                                                                                                                                                                                                                              | all functions via `_shared/client.ts`                                                                         |

Deploy after setting secrets (`supabase functions deploy`, or scope it to
just the functions a module added — see `packages/cli/README.md`'s `init`
next-steps output for the exact list per module).

## 4. Cron verification

Five scheduled jobs, each installed by its module's migration, each wrapped
in a defensive `exception when others` block so a rerun (e.g. via
`upgrade`) never fails the migration if the job already exists:

| Job name                      | Schedule                       | Module      | What it does                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `daily-moderation`            | `0 8 * * *` (08:00 UTC daily)  | core        | POSTs to `daily-moderation` — sweeps every not-yet-moderated post/comment (`moderated_at is null`) through moderation, promotes clean pending ones, and posts a Slack summary (no-op if `SLACK_WEBHOOK_URL` unset) |
| `community-like-digest`       | `0 * * * *` (hourly)           | push        | POSTs to `notify-like` — flushes any coalesced like-notification bursts the real-time trigger held back                                                                                                            |
| `community-reaction-digest`   | `30 * * * *` (half-hourly)     | reaction    | POSTs to `notify-reaction` — same digest pattern for reactions                                                                                                                                                     |
| `notifications-purge`         | `15 3 * * *` (03:15 UTC daily) | inbox       | Pure SQL, deletes `notifications` rows older than 90 days — no HTTP call, no placeholder                                                                                                                           |
| `community-translation-sweep` | `30 8 * * *` (08:30 UTC daily) | translation | POSTs to `daily-translation` — back-fills and retries translations                                                                                                                                                 |

Verify jobs registered:

```sql
select jobname, schedule, active from cron.job order by jobname;
```

Verify a job actually ran (Supabase's `pg_cron` extension logs to
`cron.job_run_details`):

```sql
select jobname, status, return_message, start_time
from cron.job_run_details
order by start_time desc
limit 20;
```

A job whose `return_message` shows an HTTP error usually means the
`__SUPABASE_PROJECT_URL__`/`__SUPABASE_ANON_KEY__` substitution didn't
happen correctly, or the target function isn't deployed yet — re-check
Section 2/3 above.

## 5. Moderation notes

- `moderate-one` runs synchronously when a post/comment is created (or a
  profile field is updated, that one through `update-profile`) — publishing is fail-closed: if the OpenAI call
  errors, nothing is published/written rather than defaulting to visible.
- `daily-moderation` is a second pass, not the only pass — it exists to
  catch anything the synchronous call missed or that later needs
  re-evaluation, and posts its findings to Slack if configured.
- `posts.status` / `comments.status` are `visible` / `hidden` / `deleted` —
  moderation always sets `hidden`, never deletes a row. Never issue a
  `DELETE` against community content directly; use the status column so
  audit history and any admin tool (including the private Rocactopus
  dashboard, or your own against the `community_dashboard` migration's
  tables) stays consistent.

### Username moderation

`profiles.username` is client-writable (the host syncs its display name into
it), so it is moderated asynchronously by `daily-moderation`
(`core/007_username_moderation.sql`): every not-yet-checked username is run
through the moderation API, flagged ones are blanked (the app shows its
anonymous fallback name) and remembered in `username_rejected` so a client
re-sync keeps them blank. The first sweeps after installing the migration
check the existing usernames, up to 1000 per run. Blanked names are listed in
the Slack summary.

### Translation

`translate-one` runs asynchronously when a post or comment is published: the
publish trigger fires it through `pg_net` (the publishing request never waits
for it), and it translates the item into every locale in
`COMMUNITY_TRANSLATION_LOCALES`. The
source language is not configured — the model detects it per item, and no
row is written for the target locale that matches the detected source (the
UI falls back to the original text for that reader). For a `gpt-5*` model
the request sets `reasoning.effort=minimal`, since reasoning effort otherwise
dominates per-item latency. `daily-translation` sweeps daily at 08:30 UTC: it
back-fills the whole history the first time the module is installed, then
catches anything `translate-one` missed (an API outage, a locale added to the
secret afterward), capped at 250 items per kind (post/comment) fetched per run
(`COMMUNITY_TRANSLATION_SWEEP_BATCH` overrides it). Each invocation translates up to 4 items at a time within a 60s time
budget; when items remain after the budget (or the fetch itself was capped),
the function re-invokes itself over HTTP so a first install back-fills the
whole history in the background, typically within hours (chained up to 200
times deep). A run that makes no progress (0 items done) never chains — that
case is left to the daily cron retry and the Slack failure count. Neither
function ever surfaces a failure to the end user — `daily-translation` posts
to Slack only when items failed or when items remain and no chain was started
(depth cap, chain request failed, or no progress; no-op if `SLACK_WEBHOOK_URL`
unset), and an item that fails simply stays "missing" for a later sweep. The
chained request forwards the incoming `Authorization` header (the anon key the
cron/trigger sends), so it passes `verify_jwt` whatever key format the
platform's `SUPABASE_ANON_KEY` env holds. `notify-comment` and
`broadcast-post` send the recipient an excerpt in their own language (resolved
from `profiles.locale` against the target locales), falling back to the
original text if no translation is available.

Two marker rows live next to the real translations in `post_translations` /
`comment_translations` (clients only ever read real locales, so neither is
visible to the app):

- `locale = 'source'` (`content = ''`): the detected source language covers
  every target, so there was nothing to translate. Written once so the sweep
  stops re-selecting the item.
- `locale = 'attempt'` (`source_locale = ''`, `content = ''`): a claim taken
  before the OpenAI call and deleted when the rows are written. While it is
  younger than 6 h no caller (translate-one, notify-comment, broadcast-post,
  the sweep) calls the API for that item, and `items_missing_translations`
  skips it; a failed attempt therefore leaves the claim, and the item is
  retried once it is older than 6 h (at most 4 paid attempts per item per
  day, whoever calls). Of two concurrent callers only one gets the claim; the
  other returns what exists (a push excerpt then falls back to the original).

First install, in this order:

1. Secrets: `COMMUNITY_TRANSLATION_LOCALES` (and optionally
   `COMMUNITY_TRANSLATION_MODEL` / `_STYLE`), `OPENAI_API_KEY` already set.
2. Deploy the functions `init`/`upgrade` added or re-synced (it lists them:
   `translate-one`, `daily-translation`, plus every function sharing
   `_shared/`), so the triggers and cron never call a missing function.
3. `supabase db push` (tables, triggers, sweep RPC, cron job).
4. First backfill by hand instead of waiting for 08:30 UTC, then read the
   response:

   ```bash
   curl -sS -X POST "https://<ref>.supabase.co/functions/v1/daily-translation" \
     -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" -d '{}'
   # {"posts":…,"comments":…,"failed":0,"remaining":…,"chained":true,"depth":0}
   ```

   `remaining > 0` with `chained: true` means the backfill continues in the
   background; `remaining > 0` with `chained: false` means it stopped (see the
   Slack message) and the daily cron resumes it. `depth` is this link's
   position in the chain.

### Who can call what

Every function sits behind the platform's `verify_jwt`, so a caller needs at
least the public anon key. On top of that:

- `moderate-one` only accepts the row's own author (user JWT, resolved
  through Auth) or the service role.
- `broadcast-post` only accepts the service role.
- `notify-comment` / `report-to-slack` / `notify-like` / `notify-reaction`
  are invoked by database triggers with the anon key and therefore treat the
  request body as untrusted: only the row `id` (or `post_id`) is read and
  everything else is re-read from the database.
- `daily-moderation` is invoked by cron with the anon key and is idempotent:
  once a sweep has stamped its items, a stray call finds nothing to check and
  returns without an API call or a Slack post.
- `translate-one` (triggers) and `daily-translation` (cron, self-chain) accept
  the anon key. `translate-one` reads only `kind` and `id` and re-reads the
  row; both only ever translate visible items that still miss a locale, and
  paid calls are bounded by the `attempt` claim row (one API call per item per
  6 h, whoever calls).

## 6. Schema drift detection

`community_meta.schema_version` (written by `core/006_meta.sql`, currently
`1`) is read by `@rocapine/community-core`'s `CommunityProvider` in dev
builds only — a mismatch against the installed package's
`REQUIRED_SCHEMA_VERSION` logs a console warning, never throws. See
`docs/compat.md` for the version table this checks against.
