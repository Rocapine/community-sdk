# @rocapine/community-ui

## 0.12.1

### Patch Changes

- 48d7ca5: Edit profile polish: centered layout, a pencil badge on the avatar opens the photo library, and one "Save" button at the bottom saves every changed field (disabled until something changed; closes the sheet on success). Tapping outside a field closes the keyboard, and a field the keyboard would cover scrolls into view. `SheetScrollView` accepts a `scrollRef`.

## 0.12.0

### Minor Changes

- 09f776d: Default names, and an editable display name and handle.

  - Every profile now starts as "<label> <digits>" / `@<handle>-<digits>` ("User 4821" / `@user-4821` by default), assigned on the first launch in the user's language. **Breaking:** `anonymousAuthorFallback` is replaced by the optional `defaultName: { label, handle }` (`label` may be a function of the host locale).
  - The app's name (`host.getDisplayName()`) seeds the profile and keeps following it, until the user edits their name in the community; then the user's edit wins. The handle follows the app's name the same way until the user picks one.
  - Edit profile: new display name field; the handle field is labelled "Handle" and a taken handle comes with a free suggestion the user can take in one tap. Names and handles containing the app's name (`COMMUNITY_APP_NAME`) are refused, as are a few staff handles.
  - `resetProfileIdentity()` puts the default name and handle back for account deletion.
  - Backend: run `npx @rocapine/community upgrade`, then push the new migration (`core/009_default_names`) and deploy `update-profile` and `daily-moderation`.

### Patch Changes

- Updated dependencies [09f776d]
  - @rocapine/community-core@0.12.0

## 0.11.1

### Patch Changes

- 0c9c112: Only the avatar and name in a post's header open the author's profile. A tap on the empty space to their right now opens the thread like the rest of the card.
- Updated dependencies [0c9c112]
  - @rocapine/community-core@0.11.1

## 0.11.0

### Minor Changes

- 84c5b85: Images in posts and comments (opt-in module `images`).

  core: `modules.images: true`. One photo per post and per comment, alone or with text; a post carries a poll or an image, never both. `useCreatePost` / `useCreateComment` take a `LocalImage` and upload it with `uploadPostImage` (public `post-images` bucket, `POST_IMAGES_BUCKET`); the lower-level `createPost` / `createComment` take its result, an `UploadedImage` (`{ path, width, height }`, now exported); optimistic items show the local file until the refetch. `FeedPost.image` and `ThreadComment.image` (`PostImage | null`, `mapImage`). `postPublished` and `commentPublished` gain `hasImage`. BREAKING (types) for hosts that build `FeedPost` / `ThreadComment` literals by hand: add `image: null`.

  ui: composer Image button next to the topic select (hidden while a poll is open), thumbnail with a remove button; feed image inside the card (rounded, aspect kept, 4:5 cap, 1.91:1 floor, final frame before load); full-screen viewer (pinch and double-tap zoom, swipe down to close; inside a thread it is an overlay within the sheet — a host rendering `CommunityPost` in its own `CommunitySheet` must not wrap it in `ImageViewerHost`); comment images at most 60% wide; the reply-bar avatar becomes the add-image button while the field is focused; inbox rows for image-only items read "📷 Photo" (new strings in all 13 catalogs). New icon role `image` — a host that types a complete `CommunityIconSet` must add it (at runtime a missing role falls back to the default); the composer's Poll toggle now carries `accessibilityRole` / `accessibilityState`. Requires `expo-image-manipulator` (native module ⇒ new build): photos are re-encoded on device (JPEG 0.8, long edge ≤ 1600 px), which strips EXIF/GPS; without it the image buttons are hidden and a dev build warns once.

  cli: new module `images` (`images/001_images.sql`: columns, the `post-images` bucket — 2 MB, JPEG only, own folder — and the sweep RPC) and `translation/003_skip_empty.sql` (the translation sweep skips image-only items). Upgrade: `npx @rocapine/community upgrade --add-modules images`, `supabase db push`, redeploy the functions.

  functions: an item with an image gets a text call (normal rules) and an image-only call (strict: `MODERATION_EXCLUDED_CATEGORIES` never applies to images); lookup errors fail closed. BEHAVIOR CHANGE: avatars are moderated strictly the same way, so apps that set `MODERATION_EXCLUDED_CATEGORIES` get stricter avatar checks. A hidden item keeps its file (dashboard restore works); an item whose verdict includes `sexual/minors` and that carries an image has its file deleted at once; files of author-deleted items and unreferenced uploads are removed by `daily-moderation` once older than 24 h. Pushes and inbox read "📷 Photo" for an image-only item (new push copy key `photo`, overridable through `COMMUNITY_PUSH_COPY`); Slack reports include the image URL. The moderation dashboard is unchanged (text only).

### Patch Changes

- Updated dependencies [84c5b85]
  - @rocapine/community-core@0.11.0

## 0.10.3

### Patch Changes

- 03c561a: Post stats (like, reaction, comment): the count rolls in when it changes — from above when it goes up, from below when it goes down — via Reanimated `entering` animations (iOS, Android, web; skipped on first render and under Reduce Motion). The composer no longer expands when a poll is added on its own: like a plain post, it expands on focus or once text is typed.

## 0.10.0

### Minor Changes

- 25eafa4: UI/UX pass.

  core: the secondary reaction can be withdrawn — `useReactToPost().mutate({ postId, on: false })`, `setReaction(cfg, postId, on)`, `applyReaction(post, on)`.
  ui: buttons with a visible surface use `PressableScale` (0.98 scale-down, no opacity, no spring); so do the post's like / reaction / comment buttons; other icon buttons and links stay plain; opening a thread blurs the composer; haptics only on choices and commits (like, reaction, vote, publish, send); the post card isn't tappable inside its own thread; pull-to-refresh spinner only for a pull; the default reaction button toggles; fixed-width stats with tabular digits; the comment button opens the thread with the reply field focused (`ThreadSheet` `focusComment`, `CommunityPost` `onPressComment`); filter chips scroll edge to edge; 44pt header icons; search bar and chips share one height; no composer while searching, plus a clear button; room under the last post for the floating compose bar; the composer drops its topic chips — it grows while composing and shows a topic select (defaults to the browsed topic); bold Publish label and a visible disabled state; four radii, concentric nesting. Theme: `colors.reaction`, `fontWeights`.
  cli: ships `reaction/003_retract.sql` (delete policy on `post_reactions`) — run `community upgrade` then `supabase db push`.

### Patch Changes

- Updated dependencies [25eafa4]
  - @rocapine/community-core@0.10.0

## 0.9.0

### Patch Changes

- 8bef3bd: - core: `useNotificationPreferences()` (push module) reads and updates the caller's `notify_likes` / `notify_comments` / `notify_reactions` flags with optimistic updates; `fetchNotificationPreferences` / `setNotificationPreference` underneath. `useCommunityUnseenCount(lastSeenAtIso, { enabled })` — `enabled: false` keeps a host's kill-switch arm from creating the identity or polling.
  - ui: icon-only buttons (inbox bell, back, overflow menus, comment send) carry `accessibilityRole` / `accessibilityLabel` (new `a11y.*` keys in every catalog). **Default icons move to expo-symbols** (SF Symbols on iOS, Material Symbols on Android/web). BREAKING for hosts that relied on the previous defaults: `npx expo install expo-symbols` (optional peer, native module ⇒ new build) or pass a complete `icons` set. The previous icon dependency is no longer referenced anywhere.
  - functions: `notify-*` send the recipient's real unread inbox count as the push `badge` (`unreadBadge`; 1 when the inbox module is absent) so the app icon badge means something. `COMMUNITY_TRANSLATION_STYLE` may be a JSON object of per-locale hints (`{ "fr": "address the reader as vous" }`), applied per target locale.
  - migrations: `push/004_delete_own_push_row.sql` — a user can delete their own `push_tokens` row (account deletion); `community upgrade` copies it, then `db push`.
- Updated dependencies [8bef3bd]
  - @rocapine/community-core@0.9.0

## 0.8.1

### Patch Changes

- e5ce99a: `update-profile` accepts `username` (the display name, 2–24 characters) and moderates it like the handle; `updateProfile({ username })` / `useUpdateProfile` pass it through. Hosts that let the user choose a pseudonym can now route it through moderation instead of writing `profiles.username` directly. `community upgrade` updates the function.

  The feed composer and the comment composer now read `host.getDisplayName()` after the `beforeSubmitPost` / `beforeSubmitComment` gate, so a pseudonym chosen inside that gate stamps the optimistic post instead of the fallback name.

- Updated dependencies [e5ce99a]
  - @rocapine/community-core@0.8.1

## 0.8.0

### Patch Changes

- 5db99b6: `anonymousAuthorFallback` accepts a `(locale: string) => string` as well as a string: hosts that ship several languages can localize the name shown for authors without a username. Read it through the new `cfg.authorFallback()` (resolved against `host.getLocale()`); the UI package does.
- Updated dependencies [5db99b6]
  - @rocapine/community-core@0.8.0

## 0.7.0

### Minor Changes

- bc5be08: Three more built-in catalogs: Korean (`ko`, 해요체), Romanian (`ro`, "tu") and Ukrainian (`uk`, "ти"), with their CLDR plural rules (`ro` one/few/other, `uk` one/few/other with 21 → one). Every catalog gains `language.ko` / `language.ro` / `language.uk` for the "Translated from …" caption.

## 0.6.0

### Minor Changes

- 0f550f9: Two additions for hosts. A formal-register French catalog, `fr-vous` (exported as `frVous`): an app that addresses its users with "vous" passes `translations.locale = "fr-vous"`; any key it lacks falls back to `fr`, then `en`. And the feed's inbox bell now shows an unread dot (`useUnreadNotificationCount`), rendered only when the inbox module is on and `onOpenInbox` is wired.

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

### Patch Changes

- Updated dependencies [36351ba]
  - @rocapine/community-core@0.5.0

## 0.4.2

### Patch Changes

- 3a7309d: Tapping an author in a thread closes the thread sheet before opening their profile, so the profile no longer opens underneath the sheet.

## 0.4.0

### Minor Changes

- cd33dd7: Sheets (thread, report, rules, profile edit) are rebuilt on `@gorhom/bottom-sheet`: swipe down from the handle (or from content scrolled to the top) to close, and in a thread the comment input stays pinned right above the keyboard while the whole thread, from the post to the last comment, stays scrollable. New peer dependencies: `@gorhom/bottom-sheet >=5.1.0`, `react-native-gesture-handler >=2.16.1`, `react-native-safe-area-context >=4.10.0` (no provider needed in the host app).

### Patch Changes

- c66022a: Switching a post, comment or poll label between its original and its translation (or expanding a post) now animates the height change instead of reserving the taller version's height: no empty space under the shorter version, and the rest of the card and the list glide with it (Reanimated, honours Reduce Motion).

## 0.3.4

### Patch Changes

- 7d9d81c: Switching a post or comment between its original and its translation no longer shifts the layout: the body is clamped from its first frame (no unclamped flash while re-measuring) and reserves the height of the taller version. Invisible measuring copies are kept out of the accessibility label.

## 0.3.0

### Minor Changes

- 4f83d20: Posts, comments and poll labels display their reader-locale translation with a per-item "Translated from X · See original" toggle; `displayText`/`translationLine` helpers; `translation.*` and `language.*` catalogue keys in 9 locales.

### Patch Changes

- Updated dependencies [4f83d20]
  - @rocapine/community-core@0.3.0

## 0.2.0

### Minor Changes

- af11ccc: Add optional pre-submit gate hooks: `ComposerCard`'s `beforeSubmit` and `ThreadSheet`'s `beforeSubmitComment` (forwarded by `CommunityFeedScreen` as `beforeSubmitPost` / `beforeSubmitComment`) let a host intercept a post or comment with an async check — e.g. a paywall that resolves once the user is entitled — before the SDK's own mutation runs. Both props are optional and default-inert: resolving `false` (or a rejection) aborts the submit silently and keeps the draft, and absent props are byte-identical to prior behavior.
- fadaed0: ProfileScreen: add optional `topInset` prop so a host mounting it as a full-screen route can push its own back button below the status bar / notch (the SDK keeps no react-native-safe-area-context dependency; the host feeds `useSafeAreaInsets().top`).
- 96668d3: - `ThreadSheet` gates the first comment behind `RulesSheet`, like `ComposerCard` does for posts (both source apps had this; it was lost in the extraction).
  - Rules acceptance is now one shared in-memory flag (`useRulesAccepted`), so accepting the rules from any `RulesSheet` — including a host-mounted one — unlocks the composer and the comment box immediately, with a single `community_rules_accepted` event.
  - CLDR plural categories: `makeT` picks `<key>.one/.few/.many/.other` via the exported `pluralCategory` (Polish few/many, French 0 → one), falling back to `.other`; the Polish catalog ships `.few` forms.
  - Feed lists are de-duplicated by post id across pages (offset pagination on a live feed could repeat a row and trip `FlatList` keys).
  - `NotificationInboxScreen.renderInboxRow` receives a third `{ unread }` argument so custom-kind rows can show the same unread state as built-in rows.
  - README: peer dep floor, gate example that settles on every paywall path, `topInset`/`slots` in the screens table.

### Patch Changes

- Updated dependencies [092a697]
  - @rocapine/community-core@0.2.0

## 0.1.0

### Minor Changes

- initial public release

### Patch Changes

- Updated dependencies
  - @rocapine/community-core@0.1.0
