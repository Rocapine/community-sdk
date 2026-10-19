# @rocapine/community

## 0.9.0

### Patch Changes

- 8bef3bd: - core: `useNotificationPreferences()` (push module) reads and updates the caller's `notify_likes` / `notify_comments` / `notify_reactions` flags with optimistic updates; `fetchNotificationPreferences` / `setNotificationPreference` underneath. `useCommunityUnseenCount(lastSeenAtIso, { enabled })` — `enabled: false` keeps a host's kill-switch arm from creating the identity or polling.
  - ui: icon-only buttons (inbox bell, back, overflow menus, comment send) carry `accessibilityRole` / `accessibilityLabel` (new `a11y.*` keys in every catalog). **Default icons move to expo-symbols** (SF Symbols on iOS, Material Symbols on Android/web). BREAKING for hosts that relied on the previous defaults: `npx expo install expo-symbols` (optional peer, native module ⇒ new build) or pass a complete `icons` set. The previous icon dependency is no longer referenced anywhere.
  - functions: `notify-*` send the recipient's real unread inbox count as the push `badge` (`unreadBadge`; 1 when the inbox module is absent) so the app icon badge means something. `COMMUNITY_TRANSLATION_STYLE` may be a JSON object of per-locale hints (`{ "fr": "address the reader as vous" }`), applied per target locale.
  - migrations: `push/004_delete_own_push_row.sql` — a user can delete their own `push_tokens` row (account deletion); `community upgrade` copies it, then `db push`.

## 0.8.1

### Patch Changes

- e5ce99a: `update-profile` accepts `username` (the display name, 2–24 characters) and moderates it like the handle; `updateProfile({ username })` / `useUpdateProfile` pass it through. Hosts that let the user choose a pseudonym can now route it through moderation instead of writing `profiles.username` directly. `community upgrade` updates the function.

  The feed composer and the comment composer now read `host.getDisplayName()` after the `beforeSubmitPost` / `beforeSubmitComment` gate, so a pseudonym chosen inside that gate stamps the optimistic post instead of the fallback name.

- 2ac9411: Edge Functions: a rejected Expo push (HTTP error such as `UNAUTHORIZED` when the Expo project has push security enabled and `EXPO_ACCESS_TOKEN` is unset, or an error ticket such as `DeviceNotRegistered`) is now logged with `console.error` instead of being swallowed. The templates also ship the `ro` / `uk` plural rule for the push copy that landed with the UI catalogs (#25) — `community upgrade` then updates `_shared/copy.ts` and `_shared/push.ts`.

## 0.6.0

### Minor Changes

- 9e0fa68: The migrations no longer carry the project URL / anon key. The pg_cron jobs and pg_net webhooks read them from Supabase Vault through the helpers in the new `core/000_settings.sql`, and the webhook functions, triggers and jobs move into `core/008_webhooks`, `push/003_webhooks`, `reaction/002_webhooks` and `translation/002_webhooks`. One `supabase/` folder now deploys unchanged to a sandbox and to production; what differs is one statement per project, run once after `db push`: `select public.community_settings_set('https://<ref>.supabase.co', '<anon key>')`. An unseeded project logs a warning per webhook instead of blocking inserts, and the daily sweeps catch up. `init` / `upgrade` stop prompting for and substituting anything; `--project-url` / `--anon-key` only fill in the printed seed statement. Existing installs: `upgrade`, `db push`, seed.

## 0.4.1

### Patch Changes

- c9797a1: `init --help` / `adopt --help` list the `translation` module alongside the others.

## 0.3.3

### Patch Changes

- 2ac6583: The OpenAI translation timeout scales with text length and target count (20 s + 5 ms per character per locale, capped at 90 s): long posts no longer time out on every attempt.

## 0.3.2

### Patch Changes

- c5ba4aa: A failed translation marks its claim so pushes waiting on it send immediately instead of after 20 s.

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
