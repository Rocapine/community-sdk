# @rocapine/community

## 0.3.1

### Patch Changes

- 28a21d3: broadcast-post pages through push_tokens (PostgREST max_rows no longer caps official broadcasts at 1000 devices); comment pushes and broadcasts wait up to 20 s for an in-flight translation instead of sending the source language.

## 0.3.0

### Minor Changes

- 4f83d20: New `translation` module: `translation/001_translations.sql`, `translate-one`, `daily-translation`; `notify-comment` and `broadcast-post` send excerpts in the recipient's language; secrets `COMMUNITY_TRANSLATION_LOCALES` (required), `COMMUNITY_TRANSLATION_MODEL`, `COMMUNITY_TRANSLATION_STYLE`.

  - `upgrade --add-modules <modules>` installs a module (e.g. `translation`) on an already-initialized backend, without re-running `init`.
  - Deno test files (`*_test.ts`) are no longer shipped in the templates nor copied into a host's `supabase/functions/`; `upgrade` ignores a host's existing copy when diffing (and drops it when it re-syncs that function).
  - A plain `upgrade` (no `--add-modules`) keeps the manifest's `modules` list as it is.
  - Optional secret `COMMUNITY_TRANSLATION_SWEEP_BATCH` (items per kind per `daily-translation` run, default 250).

- 38e13ec: - New core template `core/007_username_moderation.sql`: `profiles.username` (client-writable, never moderated) is now checked by the daily sweep — flagged names are blanked and remembered so a client re-sync keeps them blank. Additive (two nullable columns + a trigger); `npx @rocapine/community upgrade` installs it.
  - `daily-moderation` sweeps usernames (up to 1000 per run), lists blanked names in the Slack summary, and stays quiet (no API call, no Slack post) when there is nothing to check — so a stray anon-key call is free.

## 0.2.0

### Minor Changes

- bce9b4a: Backend function templates (`npx @rocapine/community upgrade` redeploys them):

  - `notify-comment` and `report-to-slack` no longer trust the trigger body: they re-read the row by id (and `notify-comment` requires it to be visible). Previously anyone holding the anon key could push arbitrary text to any post author under any name.
  - `moderate-one` only accepts the row's author (user JWT) or the service role, and every status write in `moderate-one` / `daily-moderation` is guarded on the status it read, so a post deleted mid-moderation is never resurrected.
  - `moderate-one` / `daily-moderation` query `poll_options` separately and tolerate its absence (core-only installs no longer 400 the daily sweep).
  - Locale-aware push copy for comments/likes/reactions in 9 locales (`profiles.locale`), overridable per locale and per key through the new `COMMUNITY_PUSH_COPY` JSON secret — an app keeps its own voice without forking the functions. `COMMUNITY_FALLBACK_NAME` / `COMMUNITY_REACTION_PUSH_TEXT` still work as legacy single-string overrides.

## 0.1.0

### Minor Changes

- initial public release
