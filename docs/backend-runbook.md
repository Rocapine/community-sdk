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
time (so ordering across modules stays correct regardless of install order).
The files carry nothing project-specific: the `pg_cron` jobs and `pg_net`
webhooks that call back into this project's Edge Functions
(`core/008_webhooks.sql`, `push/003_webhooks.sql`,
`reaction/002_webhooks.sql`, `translation/002_webhooks.sql`) read the project
URL and anon key from Supabase Vault through the helpers in
`core/000_settings.sql`. Seed them **once per project**, right after the
first push:

```bash
supabase db query --linked "select public.community_settings_set('https://<ref>.supabase.co', '<anon key>');"
```

(Idempotent — re-run it to rotate the key. Everything is `security definer`
and private: nothing is exposed over PostgREST.) Until a project is seeded,
each webhook logs `community-sdk: could not call Edge Function …` and returns
without aborting the insert; the daily sweeps catch up afterwards. The same
`supabase/` folder therefore deploys to a sandbox and to production — only
the seed differs: `supabase db push --project-ref <ref>` (or `--db-url`),
then the seed against that project.

**Upgrading an install from before 0.5 of the CLI** (migrations with the URL
baked in): `npx @rocapine/community upgrade` copies `core/000_settings` and
the `*_webhooks` migrations, whose `create or replace` / reschedule replace
the baked functions and jobs. Push, then seed — the CLI prints the statement.

Never renumber or hand-edit an already-applied migration; a new behavior is
always a new migration file, added via `npx @rocapine/community upgrade`.
Adding a whole new module (e.g. translation) to an already-initialized
backend: `npx @rocapine/community upgrade --add-modules translation`. For the
images module: `upgrade --add-modules images`, `supabase db push`, then
`supabase functions deploy` (moderate-one, daily-moderation, update-profile,
the notify-/broadcast- senders and report-to-slack changed with it) — see
[Images](#images). Do both **before** shipping a client build with
`modules.images: true`: that client selects the image columns in every posts
and comments query, so against a backend without them the feed breaks.

## 3. Edge Function secrets

```bash
supabase secrets set OPENAI_API_KEY=sk-... SLACK_WEBHOOK_URL=https://hooks.slack.com/... \
  COMMUNITY_APP_NAME="My App" COMMUNITY_FALLBACK_NAME="Someone" \
  COMMUNITY_PUSH_COPY='{"reaction.one":{"en":"{name} sent you support"}}' \
  MODERATION_SCORE_THRESHOLD=0.5 MODERATION_EXCLUDED_CATEGORIES=sexual \
  EXPO_ACCESS_TOKEN=...
supabase functions deploy
```

| Secret                                                                                   | Default                               | Required?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Used by                                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                                                         | none                                  | **Required.** Missing ⇒ the affected function throws at module load (`assertModerationConfigured()`) — a hard, immediate failure, not a silent degrade. With the translation module on, the key needs Moderation **and** Responses (write) access: a restricted key with only moderation makes every translation fail with 401 `Missing scopes: api.responses.write` in the function logs.                                                                                                                                                                                                                                                                                                                                      | `moderate-one`, `daily-moderation`, `update-profile`                                                          |
| `SLACK_WEBHOOK_URL`                                                                      | none                                  | Optional. Unset ⇒ `report-to-slack` and `daily-moderation`'s summary post become logged no-ops (`_shared/slack.ts` logs and returns instead of posting).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `report-to-slack`, `daily-moderation`                                                                         |
| `COMMUNITY_APP_NAME`                                                                     | `"Community"`                         | Optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `broadcast-post` — push title fallback for an admin post whose author has no username set                     |
| `COMMUNITY_PUSH_COPY`                                                                    | _(built-in neutral copy, 23 locales)_ | Optional JSON: per-locale, per-key override of every push string — `fallbackName`, `comment.title`, `like.one`, `like.many`, `reaction.one`, `reaction.many`, `photo` (the excerpt of an image-only post or comment, default "📷 Photo" localized), `message.groupBody` (`{sender}` sent a message: group pushes with `pushPreview: "sender"`), `message.neutral` (`pushPreview: "none"`) — with `{name}`/`{sender}`/`{count}` placeholders; a `*.many` value can be a `{one, few, many, other}` object picked by the recipient locale's CLDR plural category. This is how an app keeps its own voice ("prayed for you 🙏", a gendered fallback name…) without forking the functions. See `supabase/functions/_shared/copy.ts`. | `notify-comment`, `notify-like`, `notify-reaction`, `notify-message`                                          |
| `COMMUNITY_FALLBACK_NAME`                                                                | `"Someone"`                           | Optional legacy single string (every locale); `COMMUNITY_PUSH_COPY.fallbackName` wins over it. Rarely used since every profile gets a default name (core/009).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `notify-comment`, `notify-like`, `notify-reaction` — actor-name fallback when the acting user has no username |
| `COMMUNITY_REACTION_PUSH_TEXT`                                                           | `"{name} is thinking of you"`         | Optional legacy single string for the single-reactor case (every locale); `COMMUNITY_PUSH_COPY["reaction.one"]` wins over it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `notify-reaction`                                                                                             |
| `MODERATION_SCORE_THRESHOLD`                                                             | `0.5`                                 | Optional. Raw OpenAI moderation score at or above which a category is hidden even when OpenAI's own boolean flag is false (catches under-scored insults/harassment, including other languages).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `_shared/moderation.ts` (all moderating functions)                                                            |
| `MODERATION_EXCLUDED_CATEGORIES`                                                         | `""` (none excluded)                  | Optional, comma-separated. Removes listed categories from the score-threshold check only — OpenAI's own boolean flag for that category still applies regardless. **Example (a menstrual-health app):** `MODERATION_EXCLUDED_CATEGORIES=sexual` lets legitimate intimacy/fertility discussion through the score check, while OpenAI's own `sexual`/`sexual/minors` boolean flags still hide clearly explicit content. **Never applies to images:** a post/comment image and an avatar are judged strictly (every category, score threshold included), whatever this secret says — so avatars of apps that set it are now stricter than before.                                                                                   | `_shared/moderation.ts`                                                                                       |
| `EXPO_ACCESS_TOKEN`                                                                      | none                                  | Optional — only needed for an Expo project with Enhanced Security.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `_shared/push.ts` (push module)                                                                               |
| `COMMUNITY_TRANSLATION_LOCALES`                                                          | none                                  | **Required with the translation module.** Comma-separated target locales, e.g. `en,es-ES,es-419,it,pl,pt-PT,pt-BR` — must equal the client's `modules.translation.locales`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `translate-one`, `daily-translation`, `notify-comment`, `broadcast-post`                                      |
| `COMMUNITY_TRANSLATION_MODEL`                                                            | `gpt-5-mini`                          | Optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `translate-one`, `daily-translation`                                                                          |
| `COMMUNITY_TRANSLATION_STYLE`                                                            | none                                  | Optional per-app voice instruction appended to the translation prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `translate-one`, `daily-translation`                                                                          |
| `COMMUNITY_TRANSLATION_SWEEP_BATCH`                                                      | `250`                                 | Optional test/cost knob: items fetched per kind (post/comment) per `daily-translation` run. A small value (e.g. `2`) forces the self-chain on a small backlog, which is how the chain is exercised on a scratch project.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `daily-translation`                                                                                           |
| `COMMUNITY_ACCOUNT_PROVIDER`                                                             | none                                  | **Required with the accounts module.** `appwrite` or `jwks`: how `account-session` checks the app's account proof.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `account-session`, `account-delete`                                                                           |
| `COMMUNITY_ACCOUNT_SECRET`                                                               | none                                  | **Required with the accounts module.** Random, 32 bytes or more (`openssl rand -hex 32`). Keys the synthetic email of each account profile. **Never rotate it once accounts are linked:** every synthetic email would change, and each linked profile's next sign-in would fail until fixed by hand.                                                                                                                                                                                                                                                                                                                                                                                                                            | `account-session`, `account-delete`                                                                           |
| `COMMUNITY_APPWRITE_ENDPOINT` / `COMMUNITY_APPWRITE_PROJECT`                             | none                                  | **Required with `COMMUNITY_ACCOUNT_PROVIDER=appwrite`.** The Appwrite endpoint (e.g. `https://<region>.cloud.appwrite.io/v1`) and project id. The proof is an Appwrite JWT (`account.createJWT()`), checked against `GET /account`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `account-session`, `account-delete`                                                                           |
| `COMMUNITY_ACCOUNT_JWKS_URL` / `COMMUNITY_ACCOUNT_ISSUER` / `COMMUNITY_ACCOUNT_AUDIENCE` | none                                  | **Required with `COMMUNITY_ACCOUNT_PROVIDER=jwks`.** Any provider that signs JWTs with a published key set (Supabase Auth, Firebase, Clerk, Auth0, OIDC): the key set URL, and the `iss` and `aud` the token must carry. Asymmetric algorithms only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `account-session`, `account-delete`                                                                           |
| `COMMUNITY_ACCOUNT_SUBJECT_CLAIM`                                                        | `sub`                                 | Optional, `jwks` only: the claim that holds the account id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `account-session`, `account-delete`                                                                           |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`                       | —                                     | Platform-provided automatically; never set these yourself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | all functions via `_shared/client.ts`                                                                         |

Deploy after setting secrets (`supabase functions deploy`, or scope it to
just the functions a module added — see `packages/cli/README.md`'s `init`
next-steps output for the exact list per module).

## 4. Cron verification

Five scheduled jobs, each installed by its module's migration, each wrapped
in a defensive `exception when others` block so a rerun (e.g. via
`upgrade`) never fails the migration if the job already exists:

| Job name                      | Schedule                       | Module      | What it does                                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily-moderation`            | `0 8 * * *` (08:00 UTC daily)  | core        | POSTs to `daily-moderation` — sweeps every not-yet-moderated post/comment (`moderated_at is null`) through moderation, promotes clean pending ones, removes unreferenced post images (images module), and posts a Slack summary (no-op if `SLACK_WEBHOOK_URL` unset) |
| `community-like-digest`       | `0 * * * *` (hourly)           | push        | POSTs to `notify-like` — flushes any coalesced like-notification bursts the real-time trigger held back                                                                                                                                                              |
| `community-reaction-digest`   | `30 * * * *` (half-hourly)     | reaction    | POSTs to `notify-reaction` — same digest pattern for reactions                                                                                                                                                                                                       |
| `notifications-purge`         | `15 3 * * *` (03:15 UTC daily) | inbox       | Pure SQL, deletes `notifications` rows older than 90 days — no HTTP call, no placeholder                                                                                                                                                                             |
| `community-translation-sweep` | `30 8 * * *` (08:30 UTC daily) | translation | POSTs to `daily-translation` — back-fills and retries translations                                                                                                                                                                                                   |

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

A job whose `return_message` shows an HTTP error usually means the project
settings were not seeded (`select public.community_settings_set(...)`, see
Section 2) or the target function isn't deployed yet — re-check Section 2/3
above. `select name from vault.secrets` must list `community_project_url`
and `community_anon_key`.

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
  other returns what exists — except the push senders, see below.

Pushes and the claim race: a comment published `visible` fires
`notify-comment` and `translate-one` at the same moment (an admin post
fires `translate-one` just before Rocactopus calls `broadcast-post`), so the
push sender usually finds the claim already held and no rows yet. Instead of
pushing the source language, `notify-comment` and `broadcast-post` then poll
the item's translation rows every 1.5 s for up to 20 s until the claim is released or the rows cover every missing locale,
and use whatever real rows exist then. They only wait for an attempt younger
than 45 s (`IN_FLIGHT_MS`), i.e. one that can still be running: a failed
attempt keeps its claim for 6 h, and a push for such an item goes out at once
in the original language. A caller whose translation fails marks its claim
`content = 'failed'`, so pushes already waiting on it stop at once instead of
after 20 s; the item is still retried after 6 h. `translate-one` and `daily-translation` never wait.
The OpenAI request timeout scales with the text: 20 s plus 5 ms per character per
target locale, capped at 90 s (7 locales of a 1,500-character post need well over
20 s). A push never waits longer than 20 s for someone else's translation.

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

### Images

Optional `images` module (`supabase/migrations/images/001_images.sql`,
idempotent): `image_path` / `image_width` / `image_height` on `posts` and
`comments`, the public `post-images` bucket (2 MB, `image/jpeg` only, objects
`{uid}/{uuid}.jpg`, a client may only insert into its own folder; removal is by
the Edge Functions with the service role) and the `post_images_unreferenced()`
sweep RPC (service role only). The client re-encodes every photo (JPEG 0.8, long
edge ≤ 1600 px), which strips EXIF/GPS. Image-only items store `content = ''`.
Install on an existing backend: `npx @rocapine/community upgrade --add-modules
images`, `supabase db push`, `supabase functions deploy`, and only then ship a
client build with `modules.images: true` (it selects the image columns: a
backend without them breaks every posts select). A translation host
also receives `translation/003_skip_empty.sql` (the sweep skips image-only
items) on its next `upgrade`.

- **Moderation.** `moderate-one` and `daily-moderation` moderate an item's
  text with the normal rules and its image alone with the strict ones (two
  OpenAI calls for text + image, one for an image-only item) (`MODERATION_EXCLUDED_CATEGORIES` never applies to
  images; avatars are strict the same way). One verdict is the union. Fail
  closed: an image lookup that errors, or an image the API can't read, leaves
  the item pending (the sweep retries it); it is never published unchecked.
  An install without the module has no `image_path` column and moderates text
  only, as before.
- **File lifecycle.** A hidden item keeps its file, so restoring it from a
  dashboard (or setting `status = 'visible'`) brings the image back. Exception:
  a verdict that includes `sexual/minors` on an item that carries an image
  deletes the file at once. Files of author-deleted items (`status = 'deleted'`
  or the row gone) and uploads no row references (the app was killed between
  upload and insert) are removed by `daily-moderation`'s sweep once they are
  older than 24 h, up to 500 per run; the Slack summary reports "Images
  swept: N".
- **What moderators see.** The `report-to-slack` alert includes the reported
  item's image URL. The Rocactopus dashboard is unchanged and keeps showing
  text only; to look at an image, open
  `<project-url>/storage/v1/object/public/post-images/<image_path>`.
- **Pushes and inbox.** An image-only comment or admin post is announced as
  "📷 Photo" in the recipient's locale (`photo` in `COMMUNITY_PUSH_COPY`, see
  the secrets table); the UI package localizes the inbox row the same way.

### Admin broadcasts

`broadcast-post` reads `push_tokens` in pages of 1000 (newest `updated_at`
first, then `user_id`, so a token left behind by a reinstall uses the newest
registration's locale): a single select is capped at the project's PostgREST
`max_rows` (default 1000), which used to limit an admin broadcast to the
first 1000 devices. Tokens are de-duplicated before sending. If a page read fails, the function logs
`fetchAllRows: page failed, keeping N rows` and sends to the tokens already
read — do not re-run the broadcast to cover the rest, that would double-send
to everyone already pushed. Messages go to Expo 4 requests × 100 tokens at a
time, each request aborted after 10 s. The author's own devices are skipped.

Each push carries the member's own unread count as the icon badge (`unreadBadges` in
`_shared/push.ts`, the same count as the likes, comments and reactions pushes: inbox rows and
admin posts sent to everyone, past the seen marker, minus the items read one by one). It costs 4
small queries per member, 20 members at a time, before the first push goes out (estimated at a
few seconds per thousand members, not measured). A `broadcast-post` deployed before this change
sends a badge of 1 to everyone; redeploy `broadcast-post`, `notify-comment`, `notify-like` and
`notify-reaction` to pick it up.

The notification center lists an admin post only once `broadcast_at` is set
(`inbox/003_pushed_admin_posts.sql`): the center shows what was pushed. To send an admin
post from a dashboard, call `broadcast-post` with the service role; to have the app send
it, the admin author calls `request_post_broadcast(post_id)`.

### Who can call what

Every function sits behind the platform's `verify_jwt`, so a caller needs at
least the public anon key. On top of that:

- `moderate-one` only accepts the row's own author (user JWT, resolved
  through Auth) or the service role.
- `broadcast-post` accepts the service role (a dashboard), or the trigger
  (`push/005_broadcast_trigger.sql`, anon key) for a post its admin author asked to send
  ("Notify everyone" in the app's composer, `request_post_broadcast`); anything else gets 403. It stamps `posts.broadcast_at` before sending, so a post goes out once.
- `notify-comment` / `report-to-slack` / `notify-like` / `notify-reaction` / `notify-message`
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
- `translate-message` (messaging + translation) needs a member's JWT and reads the
  message with that member's own client first, so RLS decides who may translate what;
  `moderate-one` with `kind: "message"` accepts the author or the service role, with
  `kind: "group"` the creator, an in-app admin or the service role.
- `account-session` accepts anyone with a valid account proof; the device's
  own session, when sent as the bearer, only decides which anonymous profile
  is converted or merged. `account-delete` accepts a valid proof, or the
  service role with `{ provider, subject }` (the app's own backend). See
  [Accounts](#7-accounts).

## 6. Schema drift detection

`community_meta.schema_version` (written by `core/006_meta.sql`, currently
`1`) is read by `@rocapine/community-core`'s `CommunityProvider` in dev
builds only — a mismatch against the installed package's
`REQUIRED_SCHEMA_VERSION` logs a console warning, never throws. See
`docs/compat.md` for the version table this checks against.

## 7. Accounts

The optional `accounts` module gives each account of the app one community
profile: same profile on every device and after a reinstall. The app proves
its account with a short-lived token (`host.getAccountProof`), and
`account-session` answers that profile's Supabase session. Each account profile
is an auth user with a synthetic, unreachable email (`account+<hash>@account.invalid`,
an HMAC of provider and account id keyed by `COMMUNITY_ACCOUNT_SECRET`);
`account_links` (provider, subject → profile) is the only proof of ownership.

### Install and deploy

```bash
npx @rocapine/community upgrade --add-modules accounts   # or init --modules …,accounts
supabase db push
supabase secrets set COMMUNITY_ACCOUNT_PROVIDER=appwrite \
  COMMUNITY_APPWRITE_ENDPOINT=https://<region>.cloud.appwrite.io/v1 \
  COMMUNITY_APPWRITE_PROJECT=<appwrite project id> \
  COMMUNITY_ACCOUNT_SECRET=$(openssl rand -hex 32)
supabase functions deploy account-session account-delete
```

- **Keep `verify_jwt` on** for both functions (the default; never deploy them
  with `--no-verify-jwt`). `account-delete` trusts a service-role bearer
  because the gateway has already checked the JWT's signature.
- **Keep anonymous sign-ins on** ([section 1](#1-anonymous-sign-ins-manual-no-migration-does-this)):
  a signed-out member still gets an anonymous profile, unless the app sets
  `accounts.required`.
- **Turn public email sign-ups off** when the app never uses Supabase email
  sign-up (`[auth.email] enable_signup = false` in `config.toml`, or the Email
  provider's "Allow new users to sign up"). Leave the global sign-up switch
  on: it also gates anonymous sign-ins. Someone signing up on an account's
  synthetic address would hold it until `account-session` replaces them (it
  deletes an unlinked user holding the address); with email sign-ups off
  nobody can.
- With the push module, `push/006_push_devices.sql` gives each device its own
  push row (`push_devices`, keyed by `host.getInstallId()`), so a member signed
  in on two phones gets the push on both.

`account-session` answers `200 { access_token, refresh_token, profile_id, subject_hash }`,
or `200 { profile_id, subject_hash }` without tokens when the bearer already is
that account's session (the launch check of a member still signed in: nothing
is minted), `400 bad_request`, `401 bad_proof` (the provider refused the token),
`409 conflict` (the address is held by another linked profile: fix by hand),
`429 rate_limited` (one new session per account per 10 s), `503 provider_unavailable`
or `auth_unavailable`. `account-delete` answers `200 { deleted }` (`false` when
no profile was linked), `400 bad_request` (no proof, or a body that is not
JSON), `401 bad_proof`, `500 internal` (a step failed: call it again, every step
is idempotent), `503 provider_unavailable`.

**Sessions and Auth's rate limits.** A session is minted only on a sign-in,
a sign-up on a new device or an account switch: a relaunch is confirmed
without one. Each mint is a magic-link verification server-side, from the
functions' own IPs, so it counts against Auth's **token verification** rate
limit (dashboard: Authentication → Rate limits). The default is enough for
ordinary traffic; raise it before a mass sign-in (a migration, a campaign
that signs every member in at once). Past the limit `account-session` answers
`500` and the device keeps its current session and retries a minute later.

### Optional SQL hooks

The app may define these functions in `public` (service role only; revoke
execute from `public, anon, authenticated`). Each is looked up by its exact
signature, so keep the parameter names and types:

```sql
-- Profiles that already belong to this account (e.g. the member's profile from before the
-- module, found through a table the app's own server fills with (subject, profile id)).
-- Only anonymous profiles are used: others are skipped. The most recently active one
-- becomes the account profile, the others are merged into it.
create function public.account_profile_candidates(provider text, subject text, claims jsonb)
returns setof uuid ...;

-- Whether the calling device's anonymous profile may be converted or merged into this
-- account (e.g. no row of the app's server-filled table ties it to another subject).
-- NULL counts as no.
create function public.account_owns_profile(profile uuid, claims jsonb)
returns boolean ...;

-- Runs once a profile is linked to an account (e.g. record (subject, profile) in the app's
-- own table).
create function public.on_account_linked(profile uuid, provider text, subject text, claims jsonb)
returns void ...;
```

**Key the hooks on `subject`, or on data only the app's own server writes.**
`subject` is the verified account id. Two things look like proof and are not:

- `claims.prefs` (`appwrite`): Appwrite lets the member write their own
  preferences from the client, so a member can put any value there.
- Profile columns the client writes, `profiles.revenuecat_id` and
  `profiles.amplitude_id` among them: any device can set them to someone else's
  ids, and a hook trusting them hands that member's profile (posts, name,
  inbox) to the caller.

`claims` is what the provider verified: the JWT payload (`jwks`), or
`{ prefs, emailVerification, status }` (`appwrite`); in a JWT, trust only the
claims your own backend issues. Hooks **must be idempotent**: an interrupted
call runs them again on the next sign-in. A failing `on_account_linked` is
logged (`account-session: on_account_linked failed`) and not retried: the link
stands.

A profile merged into the account profile keeps its (now empty) row with the
default name, no bio and no avatar; its push preferences move, its legacy
`push_tokens` token and its `push_devices` rows do not (they are deleted: the
signed-in device registers again on the account profile). Its sessions are
revoked (`auth.sessions`, refresh tokens cascade): a device still holding the
merged profile's refresh token is signed out instead of acting as the empty
profile. The caller's new session is minted after the merge, so the device that
signs in stays signed in (`accounts/002_merge_and_delete.sql`).

### Account deletion

`account-delete` resets the account profile's name, handle, bio and avatar
(its posts stay, under the default pseudonym), clears its badges and streak
(badges and streaks modules: its old posts stop showing them), clears its `revenuecat_id` and
`amplitude_id` (so no candidates hook adopts it again), deletes its push rows, revokes
every session (all devices drop it), moves the synthetic email off and
deletes the link. The profile becomes an ordinary orphan. The app calls
`deleteAccountProfile()` before disabling its own account, or its backend
calls the function with the service role:

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/account-delete \
  -H "Authorization: Bearer <service role key>" -H "Content-Type: application/json" \
  -d '{"provider":"appwrite","subject":"<account id>"}'
```

### End-to-end check on a sandbox

Run it on a sandbox project, never production, after a deploy that touches
the accounts module. Proofs come from a throwaway Appwrite user (server API
key with `users.read` and `users.write`; `jwks` needs a test issuer instead):

```bash
REF=<project-ref>; SB=https://$REF.supabase.co; ANON=<anon key>
AW=<appwrite endpoint>; AWP=<appwrite project id>; AWK=<appwrite server key>

# Schema and functions (both idempotent).
supabase db query --linked --project-ref $REF --yes -f supabase/migrations/<ts>_community_accounts_accounts.sql
supabase db query --linked --project-ref $REF --yes -f supabase/migrations/<ts>_community_accounts_merge_and_delete.sql
supabase functions deploy account-session account-delete --project-ref $REF

# A throwaway account and its proof.
U=$(curl -s -X POST $AW/users -H "X-Appwrite-Project: $AWP" -H "X-Appwrite-Key: $AWK" \
  -H "Content-Type: application/json" -d '{"userId":"unique()","name":"e2e"}' | jq -r '.["$id"]')
JWT=$(curl -s -X POST $AW/users/$U/jwts -H "X-Appwrite-Project: $AWP" -H "X-Appwrite-Key: $AWK" | jq -r .jwt)

# Device 1: anonymous, then account-session with its bearer.
D1=$(curl -s -X POST $SB/auth/v1/signup -H "apikey: $ANON" -H "Content-Type: application/json" -d '{}')
curl -s -X POST $SB/functions/v1/account-session -H "apikey: $ANON" \
  -H "Authorization: Bearer $(jq -r .access_token <<<"$D1")" -H "Content-Type: application/json" \
  -d "{\"proof\":\"$JWT\"}"
```

Expect, in order (wait 10 s between two calls for the same account that open a session):

1. **Device 1:** `200`, `profile_id` = device 1's user id. That auth user now
   carries the synthetic email (converted in place, same uid).
2. **Device 2** (another anonymous session that posted first): `200`, the same
   `profile_id`; the post's `author_id` is now that profile.
3. **Relaunch:** the same call with device 1's account session (the
   `access_token` step 1 returned) as bearer: `200 { profile_id, subject_hash }`
   with no tokens, and a call right after it is not rate limited.
4. **Bad proof** (`{"proof":"x"}` with the anon key as bearer): `401 bad_proof`.
5. **Squatter:** create a user holding the account's synthetic email
   (`auth.admin.createUser`) before step 1: the call still answers `200`, and
   that user is gone.
6. **Candidates hook:** with a test `account_profile_candidates` installed, a
   new account adopts the most recently active returned profile and merges the
   others into it. Drop the test hook afterwards.
7. **Delete:** `account-delete` with the proof answers `{ "deleted": true }`;
   refreshing a session it returned
   (`POST $SB/auth/v1/token?grant_type=refresh_token`) now fails; a second
   delete answers `{ "deleted": false }`.
8. **Clean up:** delete every test auth user (`auth.admin.deleteUser`, which
   also removes their profiles and posts) and the Appwrite user
   (`DELETE $AW/users/$U`).

## 8. Messaging, groups and direct messages

Group chats (`modules.groups` in the app) and direct messages (`modules.dms`). `messaging` is
the chat core (conversations, members, messages, likes, edit history, the translation cache
and the settings), shared by both; `groups` adds public groups on it, `dms` one-to-one
conversations (see [Direct messages](#direct-messages-dms)).

### Install and order

```bash
npx @rocapine/community upgrade --add-modules groups   # or init --modules …,groups
supabase db push
supabase db query --linked "select public.messaging_set_settings('{\"moderation\": \"post\"}');"  # your values, see below
supabase functions deploy
```

- `groups` brings `messaging` and `attachments` with it (a group's share card is a post
  attachment, `posts.attachment`): the CLI adds both.
- Migrations, in the CLI's order: `messaging/001_messaging`, `002_push`,
  `003_settings_read`, `004_realtime_changed`, `005_review_fixes`,
  `006_rate_and_lock_order`, then `groups/001_groups`, `002_translation`,
  `003_list_conversations`, `004_members_changed`, `005_storage_sweep`,
  `006_review_fixes`, `007_online_others`. Each is applied once: re-running `messaging/001` after
  `groups/003`, or `inbox/004` after `inbox/005`, fails (a changed return type). With the inbox module,
  `inbox/005_group_events` adds `notifications.conversation_id` and returns it from
  `list_notifications` (the center's group rows); inbox before or after groups both work.
- **Push first.** Install `push` before (or with) messaging. `messaging/002_push` creates
  the group-push trigger, `claim_message_push` and `push_tokens.notify_group_messages`
  only when `push_tokens` exists. **A host that adds push after messaging must re-run
  `messaging/002_push.sql`** (`supabase db query --linked -f supabase/migrations/<ts>_community_messaging_push.sql`)
  once push is in; until then there are no group pushes.
- **Apply `messaging/002` before deploying `notify-message`**: the function calls
  `claim_message_push`, which that file creates. `db push` then `functions deploy`, in
  that order.
- **Functions.** No new secret: `OPENAI_API_KEY` moderates messages and groups, the
  translation secrets translate them. Deploy everything (`_shared/` changed under all of
  them): `moderate-one` and `daily-moderation` (messages and group fields),
  `translate-one` (group names and descriptions), `report-to-slack` (message and group
  reports), `account-delete` (`onAccountDelete`), the `notify-*` senders and
  `broadcast-post` (the badge adds followed messages), plus the new `notify-message`
  (messaging + push) and `translate-message` (messaging + translation). Keep
  `verify_jwt` as for the other functions (on): `notify-message` is called by its trigger
  with the anon key from Vault and re-reads the message; `translate-message` takes the
  member's JWT and reads the message with the caller's own client (RLS proves access).

### Settings (`messaging_set_settings`)

The backend enforces only its own copy, one row in `messaging_settings`, which clients
can't read or write. Set it from the SQL editor or the service role (a dashboard):

```sql
select public.messaging_set_settings('{"moderation": "pre", "maxMembers": 200}');
```

It merges the keys given; an unknown key or a bad value raises `invalid_setting:<key>`.
**Keep it equal to the app's config**: dev builds warn at startup when they differ
(`messaging_client_settings()`). Keys and defaults:

| Backend key                   | App option                             | Default      |
| ----------------------------- | -------------------------------------- | ------------ |
| `moderation`                  | `messaging.moderation`                 | `"post"`     |
| `translation`                 | `messaging.translation`                | `"onDemand"` |
| `pushPreview`                 | `messaging.pushPreview`                | `"full"`     |
| `onAccountDelete`             | `messaging.onAccountDelete`            | `"keep"`     |
| `maxLength`                   | `messaging.maxLength` (≤ 4000)         | `2000`       |
| `ratePerMinute`               | `messaging.ratePerMinute`              | `20`         |
| `groupsPreview`               | `groups.preview`                       | `"readOnly"` |
| `groupsRequireAccount`        | `groups.requireAccount === true`       | `false`      |
| `groupsCreateRequiresAccount` | `groups.createRequiresAccount`         | `true`       |
| `maxCreatedPerMember`         | `groups.maxCreatedPerMember`           | `3`          |
| `maxJoinedPerMember`          | `groups.maxJoinedPerMember`            | `50`         |
| `maxMembers`                  | `groups.maxMembers` (`null`: any)      | `null`       |
| `nameMaxLength`               | `groups.nameMaxLength` (≤ 120)         | `60`         |
| `descriptionMaxLength`        | `groups.descriptionMaxLength` (≤ 1000) | `500`        |
| `dmsFirstMessage`             | `dms.firstMessage`                     | `"direct"`   |
| `dmsReadReceipts`             | `dms.readReceipts`                     | `false`      |
| `dmsRequireAccount`           | `dms.requireAccount`                   | `false`      |
| `dmsRequestsPerDay`           | `dms.requestsPerDay` (≥ 1)             | `5`          |
| `dmsDeclineCooldownDays`      | `dms.declineCooldownDays` (≥ 0)        | `30`         |

The account rules (`groupsRequireAccount`, `groupsCreateRequiresAccount`, `dmsRequireAccount`)
read `account_links` only when the accounts module is installed; without it they don't apply. `groups.requireAccount: "feed"` is client only (`false` here).

### Realtime, storage, moderation

- **Realtime.** `messaging/001` adds `messages` to the `supabase_realtime` publication
  (new and changed messages, filtered by the read policies; a like is an `UPDATE` of
  `messages.like_count`, and `message_likes` stays out). `messaging/004` broadcasts
  `changed` on the private channel `conversation:<id>` when a message is hidden, since
  readers who lost access get no `postgres_changes`; typing uses the same channel.
  `groups/004` broadcasts `members` there when a group's member count changes (a join, a
  leave, a removal): open chats refresh their header, and a member just removed sees the
  removed line at once (Realtime checks a private channel's policies when it is joined,
  so they still get it). Its policies on `realtime.messages`: readers (previewers
  included) listen, only members send typing.
- **Storage.** `message-images` (private, 2 MB, JPEG/PNG/WebP,
  `<conversation>/<uid>/<uuid>.<ext>`; readers get signed URLs), `group-images` (public,
  approved images only, written by moderation) and `group-images-pending` (private,
  `<uid>/<uuid>.<ext>`, copied to `group-images` on approval). `daily-moderation`
  removes, through `messaging_images_unreferenced()` (`groups/005`, service role only),
  every file of a deleted group (its picture and its messages' images) and any upload
  no row points at after a day (an image picked and never sent, an abandoned group form).
  A file a group or message that isn't deleted still points at, or that a message's edit
  history (`message_versions`) holds, is kept, and so is anything an open report points
  at (`groups/006`: the reported message's image, now or in its history; a reported
  group's pictures, even once deleted) until the report is resolved.
- **Moderation.** The app calls `moderate-one` (`kind: "message"` or `"group"`) right
  after a send, a creation or an edit. `"post"` shows a message at once and hides it if
  flagged; `"pre"` and any image keep it pending until passed; `"reportOnly"` skips the
  AI. A group stays pending (visible to its creator only) until its name, description and
  image pass; then the creator gets `group_approved` in the center, or
  `group_field_rejected` (its details screen says which field to change). Edits keep
  their history in `message_versions`.
- **Limits on writes.** A member's sends and message edits share `ratePerMinute`
  (`messaging/005`: an edit re-runs moderation); a group takes at most 5 edits per hour
  from its creator (`groups/006`, in-app admins exempt; the app says "try again later").
  A pending group takes messages from its creator only, and a hidden or deleted one from
  nobody (`not_found`); `notify-message` pushes only for visible groups. A banned creator
  no longer deletes other members' messages.
- **Daily sweep.** `daily-moderation` (08:00 UTC) also runs the messages and groups left
  unmoderated for 5 minutes (the app's call failed), oldest first, in what remains of its
  2-minute budget, and adds the counts to its Slack summary. A `"pre"` message whose call
  failed therefore waits for it. `notifications-purge` drops group events with the rest
  after 90 days.
- **Pushes.** `notify-message` pushes each member who follows the group (bell off by
  default per group) and has `notify_group_messages` on, at most once a minute per group
  unless they read it since, never to blocked members. A message pushes at most once
  (`messages.pushed_at`, stamped before sending): a failed Expo send is not retried. `COMMUNITY_PUSH_COPY` keys:
  `message.groupBody` (`pushPreview: "sender"`), `message.neutral` (`"none"`).

### Direct messages (dms)

`modules.dms` in the app. `npx @rocapine/community upgrade --add-modules dms` (or
`init --modules …,dms`) also installs `messaging`; `groups` and `attachments` are not needed.
Then `supabase db push`, `messaging_set_settings` with the `dms*` keys above, and
`supabase functions deploy`.

- **Migrations**, after `messaging/001–006` (and `groups/*` when installed, the CLI's order):
  `dms/001_dms` (the `dm_pairs`, `dm_declines` and `dm_request_log` tables, the DM
  settings keys, the start / accept / decline / block-and-report RPCs, the read rules, a
  recipient's `visible_from`, `profile_dm_flags`, `list_dm_requests`, `dm_peer_read`,
  and replacements of `send_message`, `can_read_conversation`, `list_conversations`,
  `unread_followed_messages`, `messaging_on_account_delete` and `merge_messaging`),
  `dms/002_push` (DM pushes, `push_tokens.notify_dms`, `claim_message_push` with a `kind`),
  `dms/003_flags_search_read` (`search_dm_members`, `has_dm` in `profile_dm_flags`, the
  live "Seen" broadcast) and `dms/004_block_broadcast` (a block between two members of a DM
  broadcasts `members` on its channel, so an open DM closes its composer at once). All
  idempotent; `dms/002` needs the push module (skipped with a notice when `push_tokens`
  is missing).
- **Functions.** No new secret and no new function: `notify-message` (messaging + push)
  now pushes DMs, `report-to-slack` names a reported DM's two members and never quotes
  it, and `account-delete` applies `eraseDms`. Redeploy `notify-message` and
  `report-to-slack` after `db push` (`dms/002` first: `notify-message` reads
  `claim_message_push`'s `kind`).
- **Traps.**
  - **Adding `push` after `dms`:** re-run `messaging/002_push.sql`, **then** `dms/002_push.sql`.
    `messaging/002` alone after `dms/002` fails on `claim_message_push`'s return type;
    run `dms/002` again after it.
  - **Adding `groups` after `dms`:** `groups/003` recreates `list_conversations` without the
    DM rules, so `dms/001` must run again once groups is in (`upgrade --add-modules groups`
    copies the dms templates again; apply them, `db push`). Until then a declined request's
    last message can leak into the conversation list. Fresh installs are fine: the CLI
    orders `groups` before `dms`.
  - **Config must match the backend.** With `modules.dms` on and `dms/001` missing, the
    conversation list breaks (`dm_peers` fails and takes the whole list with it). Run
    `db push` before shipping an app build that sets `modules.dms`.
  - **DM-only installs have no storage sweep.** `messaging_images_unreferenced()` (the
    daily sweep of the messaging buckets, called by `daily-moderation`) comes with
    `groups/005`, not with `messaging` or `dms`; without it the function is a silent no-op.
    A DM-only install therefore keeps the image files of erased DM messages (`eraseDms`,
    `eraseAll`) and any upload nobody sent. Add `groups` (or run `groups/005` by hand) to
    sweep them; `message-images` is private, so this is a storage cost, not a leak.
  - **The Slack report path for a DM was not run live.** `report-to-slack`'s DM branch is
    unit-tested only (running it would post to the real channel): report one DM message from a
    sandbox first and check the line reads "Direct message from _a_ to _b_ (text not shown)".
- **Privacy at the dashboard.** A DM's text never appears in Slack. The dashboard reads a
  message only through `admin_message_context(message, before, after)`, and that answers
  only for a message that was reported or AI-hidden, with up to 50 messages around it each
  way (a pair that was never flagged stays unreadable). In-app admins can't read DMs.
- **Pushes.** `notify-message` pushes the other member of a DM unless `push_tokens.notify_dms`
  is off (default on; `useNotificationPreferences()` in the app), at most once a minute per
  DM unless they read it since, never across a block, never for a message before their
  `visible_from`. A new request pushes once, on its first message, with `message.request`
  (a neutral line that names no one, whatever `pushPreview` says). `pushPreview: "none"`
  also drops the sender's title on a DM message push. New `COMMUNITY_PUSH_COPY` keys:
  `message.dmBody` (`pushPreview: "sender"`) and `message.request`.

### Dashboard functions

`admin_message_context(message, before, after)` (a flagged message and its neighbours; in a
DM only for a reported or AI-hidden message),
`admin_edit_group`, `admin_transfer_group` and `messaging_set_settings` answer only the
service role or the SQL editor (`messaging_is_dashboard_admin()`, fail-closed); in-app
admin powers stay `profiles.is_admin`. Reports carry `message_id` or `group_id`.
