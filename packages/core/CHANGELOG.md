# @rocapine/community-core

## 0.12.0

### Minor Changes

- 09f776d: Default names, and an editable display name and handle.

  - Every profile now starts as "<label> <digits>" / `@<handle>-<digits>` ("User 4821" / `@user-4821` by default), assigned on the first launch in the user's language. **Breaking:** `anonymousAuthorFallback` is replaced by the optional `defaultName: { label, handle }` (`label` may be a function of the host locale).
  - The app's name (`host.getDisplayName()`) seeds the profile and keeps following it, until the user edits their name in the community; then the user's edit wins. The handle follows the app's name the same way until the user picks one.
  - Edit profile: new display name field; the handle field is labelled "Handle" and a taken handle comes with a free suggestion the user can take in one tap. Names and handles containing the app's name (`COMMUNITY_APP_NAME`) are refused, as are a few staff handles.
  - `resetProfileIdentity()` puts the default name and handle back for account deletion.
  - Backend: run `npx @rocapine/community upgrade`, then push the new migration (`core/009_default_names`) and deploy `update-profile` and `daily-moderation`.

## 0.11.1

### Patch Changes

- 0c9c112: `displayName()` falls back to the profile's handle when it has no username, so an author who skipped the name step but picked a username in Edit profile shows that handle instead of the anonymous fallback.

## 0.11.0

### Minor Changes

- 84c5b85: Images in posts and comments (opt-in module `images`).

  core: `modules.images: true`. One photo per post and per comment, alone or with text; a post carries a poll or an image, never both. `useCreatePost` / `useCreateComment` take a `LocalImage` and upload it with `uploadPostImage` (public `post-images` bucket, `POST_IMAGES_BUCKET`); the lower-level `createPost` / `createComment` take its result, an `UploadedImage` (`{ path, width, height }`, now exported); optimistic items show the local file until the refetch. `FeedPost.image` and `ThreadComment.image` (`PostImage | null`, `mapImage`). `postPublished` and `commentPublished` gain `hasImage`. BREAKING (types) for hosts that build `FeedPost` / `ThreadComment` literals by hand: add `image: null`.

  ui: composer Image button next to the topic select (hidden while a poll is open), thumbnail with a remove button; feed image inside the card (rounded, aspect kept, 4:5 cap, 1.91:1 floor, final frame before load); full-screen viewer (pinch and double-tap zoom, swipe down to close; inside a thread it is an overlay within the sheet — a host rendering `CommunityPost` in its own `CommunitySheet` must not wrap it in `ImageViewerHost`); comment images at most 60% wide; the reply-bar avatar becomes the add-image button while the field is focused; inbox rows for image-only items read "📷 Photo" (new strings in all 13 catalogs). New icon role `image` — a host that types a complete `CommunityIconSet` must add it (at runtime a missing role falls back to the default); the composer's Poll toggle now carries `accessibilityRole` / `accessibilityState`. Requires `expo-image-manipulator` (native module ⇒ new build): photos are re-encoded on device (JPEG 0.8, long edge ≤ 1600 px), which strips EXIF/GPS; without it the image buttons are hidden and a dev build warns once.

  cli: new module `images` (`images/001_images.sql`: columns, the `post-images` bucket — 2 MB, JPEG only, own folder — and the sweep RPC) and `translation/003_skip_empty.sql` (the translation sweep skips image-only items). Upgrade: `npx @rocapine/community upgrade --add-modules images`, `supabase db push`, redeploy the functions.

  functions: an item with an image gets a text call (normal rules) and an image-only call (strict: `MODERATION_EXCLUDED_CATEGORIES` never applies to images); lookup errors fail closed. BEHAVIOR CHANGE: avatars are moderated strictly the same way, so apps that set `MODERATION_EXCLUDED_CATEGORIES` get stricter avatar checks. A hidden item keeps its file (dashboard restore works); an item whose verdict includes `sexual/minors` and that carries an image has its file deleted at once; files of author-deleted items and unreferenced uploads are removed by `daily-moderation` once older than 24 h. Pushes and inbox read "📷 Photo" for an image-only item (new push copy key `photo`, overridable through `COMMUNITY_PUSH_COPY`); Slack reports include the image URL. The moderation dashboard is unchanged (text only).

## 0.10.0

### Minor Changes

- 25eafa4: UI/UX pass.

  core: the secondary reaction can be withdrawn — `useReactToPost().mutate({ postId, on: false })`, `setReaction(cfg, postId, on)`, `applyReaction(post, on)`.
  ui: buttons with a visible surface use `PressableScale` (0.98 scale-down, no opacity, no spring); so do the post's like / reaction / comment buttons; other icon buttons and links stay plain; opening a thread blurs the composer; haptics only on choices and commits (like, reaction, vote, publish, send); the post card isn't tappable inside its own thread; pull-to-refresh spinner only for a pull; the default reaction button toggles; fixed-width stats with tabular digits; the comment button opens the thread with the reply field focused (`ThreadSheet` `focusComment`, `CommunityPost` `onPressComment`); filter chips scroll edge to edge; 44pt header icons; search bar and chips share one height; no composer while searching, plus a clear button; room under the last post for the floating compose bar; the composer drops its topic chips — it grows while composing and shows a topic select (defaults to the browsed topic); bold Publish label and a visible disabled state; four radii, concentric nesting. Theme: `colors.reaction`, `fontWeights`.
  cli: ships `reaction/003_retract.sql` (delete policy on `post_reactions`) — run `community upgrade` then `supabase db push`.

## 0.9.0

### Minor Changes

- 8bef3bd: - core: `useNotificationPreferences()` (push module) reads and updates the caller's `notify_likes` / `notify_comments` / `notify_reactions` flags with optimistic updates; `fetchNotificationPreferences` / `setNotificationPreference` underneath. `useCommunityUnseenCount(lastSeenAtIso, { enabled })` — `enabled: false` keeps a host's kill-switch arm from creating the identity or polling.
  - ui: icon-only buttons (inbox bell, back, overflow menus, comment send) carry `accessibilityRole` / `accessibilityLabel` (new `a11y.*` keys in every catalog). **Default icons move to expo-symbols** (SF Symbols on iOS, Material Symbols on Android/web). BREAKING for hosts that relied on the previous defaults: `npx expo install expo-symbols` (optional peer, native module ⇒ new build) or pass a complete `icons` set. The previous icon dependency is no longer referenced anywhere.
  - functions: `notify-*` send the recipient's real unread inbox count as the push `badge` (`unreadBadge`; 1 when the inbox module is absent) so the app icon badge means something. `COMMUNITY_TRANSLATION_STYLE` may be a JSON object of per-locale hints (`{ "fr": "address the reader as vous" }`), applied per target locale.
  - migrations: `push/004_delete_own_push_row.sql` — a user can delete their own `push_tokens` row (account deletion); `community upgrade` copies it, then `db push`.

## 0.8.1

### Patch Changes

- e5ce99a: `update-profile` accepts `username` (the display name, 2–24 characters) and moderates it like the handle; `updateProfile({ username })` / `useUpdateProfile` pass it through. Hosts that let the user choose a pseudonym can now route it through moderation instead of writing `profiles.username` directly. `community upgrade` updates the function.

  The feed composer and the comment composer now read `host.getDisplayName()` after the `beforeSubmitPost` / `beforeSubmitComment` gate, so a pseudonym chosen inside that gate stamps the optimistic post instead of the fallback name.

## 0.8.0

### Minor Changes

- 5db99b6: `anonymousAuthorFallback` accepts a `(locale: string) => string` as well as a string: hosts that ship several languages can localize the name shown for authors without a username. Read it through the new `cfg.authorFallback()` (resolved against `host.getLocale()`); the UI package does.

## 0.5.0

### Minor Changes

- 36351ba: Restore what the Eve's Rhythm community did before the SDK migration:

  - Floating "write a post" bar once the inline composer scrolls away (tap: scroll up + focus, or the rules sheet while locked; accepting the rules focuses the composer). New `compose` icon role.
  - A post that fails to send shows the network notice and puts the draft back (`ComposerCard` `onPublishFailed`); a failed comment draft comes back too.
  - A rejected/failed comment closes the thread and shows its notice over the screen, instead of behind the thread sheet.
  - Optimistic posts/comments carry your own uid/avatar (tap → your profile, not an empty-id route); new `isOptimistic(item)` helper in core for id-keyed actions.
  - Relative timestamps refresh every minute (`useNow`).
  - `CommunityFeedScreen` `isFocused` prop: new-post polling stops while the screen is hidden (tabs).
  - `onOpenProfile(userId, source)` + `ProfileScreen` `source` prop: `profileOpened` reports `"comment"` again.
  - Comment field shows your avatar.
  - Avatars resized to 512px JPEG before upload when the optional `expo-image-manipulator` peer is installed (`resizeAvatar` exported).
  - Haptic on poll votes.
  - Inbox: re-marks seen when a newer item lands mid-visit; `onOpenCommunity` for rows without a post; authorless announcements read `inbox.newsFromTeam`.
  - Slots get `ctx.presentModal(open)`: inside `ThreadSheet` it closes the sheet before opening the host's Modal (opening one on top froze every touch on iOS).

## 0.3.0

### Minor Changes

- 4f83d20: Translation module: `modules.translation`, `readerLocale`, reader-locale translation embeds in feed/thread selects (only when the module is on), `translation` fields on `FeedPost`/`ThreadComment` and `translatedLabel` on poll options (`text` stays the original), inbox excerpts in the reader locale, `community_translation_toggled` event.

## 0.2.0

### Minor Changes

- 092a697: Fix: the posts select embedded `poll_options(...)` regardless of `modules.polls`, so on a backend installed without the polls module (no `poll_options` table) every feed / user-posts / search query failed with PostgREST `PGRST200` and the feed rendered "unreachable". The embed is now added only when `modules.polls` is on (`buildFeedSelect(extraPostColumns, polls)`), and `mapPostRow`/`buildPoll` tolerate a missing `poll_options` field. Also: `useToggleLike` now applies its optimistic update to the user-posts and search caches too (same sweep as votes/reactions), and `useDeleteContent` invalidates them.

## 0.1.0

### Minor Changes

- initial public release
