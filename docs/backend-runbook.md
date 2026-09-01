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
placeholders that three migrations carry
(`core/003_moderation.sql`, `push/002_triggers.sql`,
`reaction/001_reactions.sql` — each schedules a `pg_cron` job that calls
back into this same project via `pg_net`). A migration with an
unsubstituted placeholder fails loudly at `db push` (a `DO` block re-checks
this at push time, in addition to the CLI's own pre-write check), rather
than silently pushing and failing later at cron/webhook runtime.

Never renumber or hand-edit an already-applied migration; a new behavior is
always a new migration file, added via `npx @rocapine/community upgrade`.

## 3. Edge Function secrets

```bash
supabase secrets set OPENAI_API_KEY=sk-... SLACK_WEBHOOK_URL=https://hooks.slack.com/... \
  COMMUNITY_APP_NAME="My App" COMMUNITY_FALLBACK_NAME="Someone" \
  COMMUNITY_REACTION_PUSH_TEXT="{name} sent you support" \
  MODERATION_SCORE_THRESHOLD=0.5 MODERATION_EXCLUDED_CATEGORIES=sexual \
  EXPO_ACCESS_TOKEN=...
supabase functions deploy
```

| Secret                                                             | Default                       | Required?                                                                                                                                                                                                                                                                                                                                                                                                                          | Used by                                                                                                       |
| ------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                                   | none                          | **Required.** Missing ⇒ the affected function throws at module load (`assertModerationConfigured()`) — a hard, immediate failure, not a silent degrade.                                                                                                                                                                                                                                                                            | `moderate-one`, `daily-moderation`, `update-profile`                                                          |
| `SLACK_WEBHOOK_URL`                                                | none                          | Optional. Unset ⇒ `report-to-slack` and `daily-moderation`'s summary post become logged no-ops (`_shared/slack.ts` logs and returns instead of posting).                                                                                                                                                                                                                                                                           | `report-to-slack`, `daily-moderation`                                                                         |
| `COMMUNITY_APP_NAME`                                               | `"Community"`                 | Optional.                                                                                                                                                                                                                                                                                                                                                                                                                          | `broadcast-post` — push title fallback for an official post whose author has no username set                  |
| `COMMUNITY_FALLBACK_NAME`                                          | `"Someone"`                   | Optional, but should match `CommunityConfig.anonymousAuthorFallback` on the client so pushes and UI agree.                                                                                                                                                                                                                                                                                                                         | `notify-comment`, `notify-like`, `notify-reaction` — actor-name fallback when the acting user has no username |
| `COMMUNITY_REACTION_PUSH_TEXT`                                     | `"{name} is thinking of you"` | Optional, reaction module only. **Caveat:** this overrides the single-reactor push template for every recipient locale at once — it is one string, not a per-locale map. `{name}` is substituted. The multi-reactor "and N others" phrasing is always the built-in per-locale copy; there's no secret for that variant.                                                                                                            | `notify-reaction`                                                                                             |
| `MODERATION_SCORE_THRESHOLD`                                       | `0.5`                         | Optional. Raw OpenAI moderation score at or above which a category is hidden even when OpenAI's own boolean flag is false (catches under-scored insults/harassment, including other languages).                                                                                                                                                                                                                                    | `_shared/moderation.ts` (all moderating functions)                                                            |
| `MODERATION_EXCLUDED_CATEGORIES`                                   | `""` (none excluded)          | Optional, comma-separated. Removes listed categories from the score-threshold check only — OpenAI's own boolean flag for that category still applies regardless. **Example (Eve's Rhythm, a menstrual-health app):** `MODERATION_EXCLUDED_CATEGORIES=sexual` lets legitimate intimacy/fertility discussion through the score check, while OpenAI's own `sexual`/`sexual/minors` boolean flags still hide clearly explicit content. | `_shared/moderation.ts`                                                                                       |
| `EXPO_ACCESS_TOKEN`                                                | none                          | Optional — only needed for an Expo project with Enhanced Security.                                                                                                                                                                                                                                                                                                                                                                 | `_shared/push.ts` (push module)                                                                               |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | —                             | Platform-provided automatically; never set these yourself.                                                                                                                                                                                                                                                                                                                                                                         | all functions via `_shared/client.ts`                                                                         |

Deploy after setting secrets (`supabase functions deploy`, or scope it to
just the functions a module added — see `packages/cli/README.md`'s `init`
next-steps output for the exact list per module).

## 4. Cron verification

Four scheduled jobs, each installed by its module's migration, each wrapped
in a defensive `exception when others` block so a rerun (e.g. via
`upgrade`) never fails the migration if the job already exists:

| Job name                    | Schedule                       | Module   | What it does                                                                                                                                                    |
| --------------------------- | ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily-moderation`          | `0 8 * * *` (08:00 UTC daily)  | core     | POSTs to `daily-moderation` — sweeps recently-published content through moderation a second time and posts a Slack summary (no-op if `SLACK_WEBHOOK_URL` unset) |
| `community-like-digest`     | `0 * * * *` (hourly)           | push     | POSTs to `notify-like` — flushes any coalesced like-notification bursts the real-time trigger held back                                                         |
| `community-reaction-digest` | `30 * * * *` (half-hourly)     | reaction | POSTs to `notify-reaction` — same digest pattern for reactions                                                                                                  |
| `notifications-purge`       | `15 3 * * *` (03:15 UTC daily) | inbox    | Pure SQL, deletes `notifications` rows older than 90 days — no HTTP call, no placeholder                                                                        |

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
  profile field is updated) — publishing is fail-closed: if the OpenAI call
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

## 6. Schema drift detection

`community_meta.schema_version` (written by `core/006_meta.sql`, currently
`1`) is read by `@rocapine/community-core`'s `CommunityProvider` in dev
builds only — a mismatch against the installed package's
`REQUIRED_SCHEMA_VERSION` logs a console warning, never throws. See
`docs/compat.md` for the version table this checks against.
