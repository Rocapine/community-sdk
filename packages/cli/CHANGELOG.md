# @rocapine/community

## 0.13.0

### Minor Changes

- d64bea8: Flat, X-style community screens (EVR's design). Relative timestamps now count seconds, months and years (`timeAgoParts` gains the `second`, `month` and `year` units; `time.seconds`, `time.months.*` and `time.years.*` in every locale), and a label under a minute old ticks every second.

  **community-ui (breaking).** The feed, the in-community profile and the notification inbox drop their cards for flat, full-width rows: the avatar in a first column, `name › topic · time` on one line with the `…` menu at its end (the `@handle` stays on the profile), and "View more" at the end of a body's last visible line. Topics are scrollable tabs, and `headerLayout.title` takes an image (`{ image, position?, accessibilityLabel? }`) for an app logo.

  - **Composer.** `ComposerCard` and the floating compose bar are removed (export gone). A `+` button opens the new full-screen `ComposerSheet` (exported). `beforeSubmitPost` is replaced by **`beforeCompose: () => Promise<boolean>`**, awaited on the `+` tap after the rules and before the composer opens. Migration: pass your post gate as `beforeCompose` (it no longer receives a draft).
  - **Topics.** Tapping a post's topic selects its tab in the feed (and from its search and thread). `ProfileScreen` and `ThreadSheet` take `onPressTopic(topicId)`; the feed takes `topicRequest: { topicId, requestedAt }` so a host can land on a topic from elsewhere.
  - **Avatars.** `CommunityUIProvider` takes `renderAvatar({ userId, name, url, size })`, used by every avatar the SDK draws; `Avatar` is exported. The default is unchanged.
  - **Feed chrome.** The top bar (header and topic tabs) hides as the reader scrolls down and comes back on the way up. `bottomChrome: { height, hidden }` lets a host's floating tab bar hide in step (the feed writes `hidden`, a Reanimated shared value, from 0 to 1); the `+` button rides on it.
  - **Comments.** Comments can be liked and replied to, one level deep under their root comment ("Replying to @handle" above the field). New icon roles `reply` and `markAllRead` — a host that types a complete `CommunityIconSet` must add them (at runtime a missing role falls back to the default).
  - **Posts from outside.** The feed takes `postRequest: { postId, requestedAt }` to open a post's thread, e.g. from a tapped push. `ThreadSheet` loads a post no list has loaded yet.
  - **Inbox.** With `inboxReadMode: "tap"` a row is read once tapped (unread rows are marked), and the header offers "Mark all as read" (disabled when nothing is unread). Rows for replies read "{name} replied to your comment".
  - **Web.** "View more" is cut from the browser's real lines and sits inline like on native; multiline fields size to their text; no focus ring on fields; the composer's topic menu and date column work on react-native-web.
  - New strings in all 13 catalogs: `composer.cancel`, `composer.discardTitle`, `composer.discard`, `composer.keepEditing`, `feed.compose`, `time.seconds`, `time.months.*`, `time.years.*`, `thread.replyingTo`, `a11y.like`, `a11y.reply`, `a11y.cancelReply`, `inbox.replied`, `inbox.markAllRead`.

  **community-core.** `CommunityConfig` gains `postMaxLength` (default `DEFAULT_POST_MAX_LENGTH`, 500; capped at the database's `POST_MAX_LENGTH`) and `inboxReadMode: "open" | "tap"` (default `"open"`, unchanged behavior). New: `useCreateComment` takes `parentId`, `setCommentLike` / `useToggleCommentLike`, `fetchPost` / `usePost`, `markInboxItemRead` / `useMarkInboxItemRead`, `isUnread`, and `useMarkPostNotificationsRead()(postId, kind?)`, which marks a post's unread inbox items read (call it when a push about the post is tapped). The inbox refetches every 2 minutes while the app is open.

  **Backend.** Run `npx @rocapine/community upgrade`, then push the new migrations (`core/010_comment_threads`: `comments.parent_id` and `comment_likes`; `inbox/002_replies_and_reads`: `reply` notifications and `notification_reads`) and redeploy `notify-comment`, `notify-like`, `notify-reaction` and `broadcast-post`. Both migrations are additive, safe for installed app versions. A reply now notifies only the author of the comment it answers (push `community_reply`, new copy key `reply.title`), no longer the post's author. Every community push carries the post's id: `data: { route: "/community", kind, postId }`. The push badge no longer counts items read one by one.

## 0.12.0

### Minor Changes

- 09f776d: Default names, and an editable display name and handle.

  - Every profile now starts as "<label> <digits>" / `@<handle>-<digits>` ("User 4821" / `@user-4821` by default), assigned on the first launch in the user's language. **Breaking:** `anonymousAuthorFallback` is replaced by the optional `defaultName: { label, handle }` (`label` may be a function of the host locale).
  - The app's name (`host.getDisplayName()`) seeds the profile and keeps following it, until the user edits their name in the community; then the user's edit wins. The handle follows the app's name the same way until the user picks one.
  - Edit profile: new display name field; the handle field is labelled "Handle" and a taken handle comes with a free suggestion the user can take in one tap. Names and handles containing the app's name (`COMMUNITY_APP_NAME`) are refused, as are a few staff handles.
  - `resetProfileIdentity()` puts the default name and handle back for account deletion.
  - Backend: run `npx @rocapine/community upgrade`, then push the new migration (`core/009_default_names`) and deploy `update-profile` and `daily-moderation`.

## 0.11.0

### Minor Changes

- 84c5b85: Images in posts and comments (opt-in module `images`).

  core: `modules.images: true`. One photo per post and per comment, alone or with text; a post carries a poll or an image, never both. `useCreatePost` / `useCreateComment` take a `LocalImage` and upload it with `uploadPostImage` (public `post-images` bucket, `POST_IMAGES_BUCKET`); the lower-level `createPost` / `createComment` take its result, an `UploadedImage` (`{ path, width, height }`, now exported); optimistic items show the local file until the refetch. `FeedPost.image` and `ThreadComment.image` (`PostImage | null`, `mapImage`). `postPublished` and `commentPublished` gain `hasImage`. BREAKING (types) for hosts that build `FeedPost` / `ThreadComment` literals by hand: add `image: null`.

  ui: composer Image button next to the topic select (hidden while a poll is open), thumbnail with a remove button; feed image inside the card (rounded, aspect kept, 4:5 cap, 1.91:1 floor, final frame before load); full-screen viewer (pinch and double-tap zoom, swipe down to close; inside a thread it is an overlay within the sheet — a host rendering `CommunityPost` in its own `CommunitySheet` must not wrap it in `ImageViewerHost`); comment images at most 60% wide; the reply-bar avatar becomes the add-image button while the field is focused; inbox rows for image-only items read "📷 Photo" (new strings in all 13 catalogs). New icon role `image` — a host that types a complete `CommunityIconSet` must add it (at runtime a missing role falls back to the default); the composer's Poll toggle now carries `accessibilityRole` / `accessibilityState`. Requires `expo-image-manipulator` (native module ⇒ new build): photos are re-encoded on device (JPEG 0.8, long edge ≤ 1600 px), which strips EXIF/GPS; without it the image buttons are hidden and a dev build warns once.

  cli: new module `images` (`images/001_images.sql`: columns, the `post-images` bucket — 2 MB, JPEG only, own folder — and the sweep RPC) and `translation/003_skip_empty.sql` (the translation sweep skips image-only items). Upgrade: `npx @rocapine/community upgrade --add-modules images`, `supabase db push`, redeploy the functions.

  functions: an item with an image gets a text call (normal rules) and an image-only call (strict: `MODERATION_EXCLUDED_CATEGORIES` never applies to images); lookup errors fail closed. BEHAVIOR CHANGE: avatars are moderated strictly the same way, so apps that set `MODERATION_EXCLUDED_CATEGORIES` get stricter avatar checks. A hidden item keeps its file (dashboard restore works); an item whose verdict includes `sexual/minors` and that carries an image has its file deleted at once; files of author-deleted items and unreferenced uploads are removed by `daily-moderation` once older than 24 h. Pushes and inbox read "📷 Photo" for an image-only item (new push copy key `photo`, overridable through `COMMUNITY_PUSH_COPY`); Slack reports include the image URL. The moderation dashboard is unchanged (text only).

## 0.10.2

### Patch Changes

- edd3e07: `init` records only the function files it copies in `community-sdk.json`. A host file already present in an SDK function folder (e.g. `supabase/functions/_shared/<your-dir>/`) was listed too: `init`'s rollback on error would delete it, and since 0.10.1 `upgrade` would remove it as a file the SDK no longer ships. If your manifest's `installedFiles` lists any of your own files, remove those lines before running `upgrade`.

## 0.10.1

### Patch Changes

- 4e7e660: `upgrade` no longer deletes the host's own files inside an SDK function folder (e.g. `supabase/functions/_shared/<your-dir>/`). It now overwrites only the files the template ships, removes only files an earlier SDK version installed (per `community-sdk.json`) that the template dropped, and ignores host files when deciding whether a function changed. 0.10.0 wiped such folders: if you ran `upgrade` with it, check `git status` for deleted files under `supabase/functions/` and restore them.

## 0.10.0

### Minor Changes

- 25eafa4: UI/UX pass.

  core: the secondary reaction can be withdrawn — `useReactToPost().mutate({ postId, on: false })`, `setReaction(cfg, postId, on)`, `applyReaction(post, on)`.
  ui: buttons with a visible surface use `PressableScale` (0.98 scale-down, no opacity, no spring); so do the post's like / reaction / comment buttons; other icon buttons and links stay plain; opening a thread blurs the composer; haptics only on choices and commits (like, reaction, vote, publish, send); the post card isn't tappable inside its own thread; pull-to-refresh spinner only for a pull; the default reaction button toggles; fixed-width stats with tabular digits; the comment button opens the thread with the reply field focused (`ThreadSheet` `focusComment`, `CommunityPost` `onPressComment`); filter chips scroll edge to edge; 44pt header icons; search bar and chips share one height; no composer while searching, plus a clear button; room under the last post for the floating compose bar; the composer drops its topic chips — it grows while composing and shows a topic select (defaults to the browsed topic); bold Publish label and a visible disabled state; four radii, concentric nesting. Theme: `colors.reaction`, `fontWeights`.
  cli: ships `reaction/003_retract.sql` (delete policy on `post_reactions`) — run `community upgrade` then `supabase db push`.

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
