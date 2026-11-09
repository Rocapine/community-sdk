# @rocapine/community-ui

## 0.15.0

### Minor Changes

- b69bf37: **Admins pin and notify everyone from the composer.** An admin's composer shows two
  options above the toolbar: "Pin" (`composer.pinPost`) pins the post once it is created,
  and "Notify everyone" (`composer.notifyAll`, push module only) pushes it to every member
  once it is published, also when moderation publishes it later. `CreatePostVariables`
  takes `pin` and `notifyAll`; core exports `requestPostBroadcast()`.

  `adminPostsNotifyAll` (default false): every admin post notifies everyone, and the
  composer drops the "Notify everyone" option.

  `maxPinnedPerTopic` (default 1) caps the pinned posts of a topic. Pinning one more, from
  the composer or a post's `…` menu, shows a warning (`pin.limitTitle` / `pin.limitBody`)
  and pins nothing; core exports `countPinnedPosts()`.

  **The notification center lists what was pushed.** An admin post appears in the center
  only once it was sent to everyone, dated when it was sent; admin posts that were never
  pushed leave it, also for app versions already installed. The broadcast never reaches
  the author's own devices, and a post goes out once.

  Backend: `core/013_post_broadcasts.sql` (`posts.broadcast_requested`,
  `posts.broadcast_at`, `request_post_broadcast()`, admins only),
  `push/005_broadcast_trigger.sql` (sends once the post is visible) and
  `inbox/003_pushed_admin_posts.sql`. `broadcast-post` accepts the service role, or the
  trigger for a post its admin author asked to send. Run
  `npx @rocapine/community upgrade`, `supabase db push`, then redeploy `broadcast-post`.

- 6672084: **Admins pin posts from the app.** An admin's `…` menu on a post offers "Pin" or
  "Unpin" (`post.pin` / `post.unpin`). Pinned posts lead "All" and their topic, newest pin
  first, until unpinned. Through `set_post_pinned` (`core/012_pin_posts.sql`), which
  refuses anyone but an admin; `usePinPost()` / `setPostPinned()` in core. Run
  `npx @rocapine/community upgrade` and `supabase db push`.
- 6092dbb: **Admin accounts and admin-only topics (breaking).** "Official" accounts are now called
  admin accounts everywhere, and any topic can be reserved for them, not only `news`.

  - Everyone reads an `adminOnly: true` topic. On its tab a member gets no `+` and never
    sees it in the composer; an admin gets the `+`, with that topic preselected. Its tab
    leads with the `announcement` icon, and its empty state reads `feed.adminTopicEmpty`.
  - The database no longer reserves `news` (`core/011_admins.sql`): which topics are
    admin-only is the app's config, applied by the UI.

  Migration:

  - Run `npx @rocapine/community upgrade`, then `supabase db push`. `profiles.is_official`
    becomes `is_admin`; a read-only `is_official` copy stays for app versions on 0.14 or
    older, and the inbox still names admin posts `official_post` for them (0.15 reads
    both). Make an account admin with `update profiles set is_admin = true where id = …`.
  - Renames: `CommunityTopicDef.officialOnly` → `adminOnly`, `isOfficialTopic` →
    `isAdminTopic`, `FeedPost`/`ThreadComment.authorOfficial` → `authorAdmin`,
    `CommunityProfile.official` → `admin`, the `renderAvatar` prop `official` → `admin`,
    the inbox kind `official_post` → `admin_post`, the icon `officialSeal` → `adminSeal`,
    the colors `official`/`officialName` → `admin`/`adminName`, the string
    `feed.newsEmpty` → `feed.adminTopicEmpty`, and `broadcast-post`'s push data kind
    `community_official_post` → `community_admin_post`.
  - `composeTopics(admin?)` now takes whether the author is an admin.

- 05caa2d: Attachments. A post can carry one reference to the app's own content (`{ type, id }`: a
  verse, a recipe, a session), never a URL: each reader's app draws the card from its own
  data with `renderAttachment(attachment, { placement, open })` and opens it with
  `onOpenAttachment` (both on `CommunityUIProvider`). Configure it with
  `modules.attachments: { types, membersCanAttach }`; official accounts can always attach.
  Share from the app with `CommunityFeedScreen`'s `composeRequest`
  (`{ attachment?, text?, requestedAt }`): the composer opens with the card, through the same
  gates as `+`. A post carries an attachment, a poll or a photo, never two, and still needs
  text (pass `text` in the request to pre-fill it).

  New backend module `attachments` (`posts.attachment`, shape and size checked).
  Core: `createPost({ attachment })`, `FeedPost.attachment`, `canAttach`, `PostAttachment`.
  UI: new string `composer.removeAttachment`.

- 7ff8196: Backgrounds. `CommunityFeedScreen`'s `header` takes `background: { image?, color?, contentFit? }`,
  painted behind the header row and the topic tabs, and `topInset`: pass your safe area's top
  and stop padding it, and the feed owns the status bar area (the header background reaches
  behind it; the bar stops hiding there). `CommunityUIProvider` takes
  `background: { image, contentFit?, opacity? }`, fixed behind the feed, the notification
  center and profiles; post rows turn transparent over it while sheets and the composer stay
  opaque. `useCommunityBackground()` and the `CommunityBackground` type are exported.
- e3661c7: **Event topics.** A topic with `from` / `until` (`{ id: "nnn", from: "2026-11-01", until:
"2026-12-01" }`) only exists inside its window, read on the device's clock (a bare date
  is local midnight, `until` excluded): its tab comes right after "All" and the composer
  offers it, without preselecting it from "All". Outside the window the tab is gone and
  its posts stay in "All" with their label. The feed re-reads the clock on focus and
  foreground, and leaves a tab whose event ended for "All". Feed the dates from remote
  config to move an event without a release.

  **Topic styles.** `CommunityUIProvider`'s `topicStyles` gives a topic's tab an icon
  before its name and a pill tinted in its color. By default an event topic is tinted in
  `accent` and an admin-only topic leads with the `announcement` icon.

  Core: `cfg.feedTopics(now?)`, `cfg.composeTopics(admin?, now?)` (live topics, events
  first), `topicLive()`, `isEventTopic()`.

- 1d47f8c: **The feed's top bar can share the community background.** `header.background:
"community"` draws `CommunityUIProvider`'s `background` in the bar, laid out for the
  whole screen and held still while the bar hides on scroll, so bar and feed read as one
  image. New colors `headerText` (title, header icons, selected tab) and `headerTextMuted`
  (other tabs), defaulting to `textPrimary` / `textMuted`, for a bar that needs other text
  than the feed.
- 07c33a5: **community-ui (breaking).** The feed header is configured in three zones. `header`
  takes `{ left?, center?, right?, background? }`, each zone a row of items: `"title"`,
  `"profile"`, `"search"`, `"inbox"` or `{ logo, height?, width?, accessibilityLabel? }`.
  The center zone stays centered; a logo and the title can sit side by side.
  `DEFAULT_FEED_HEADER` is `{ left: ["profile"], center: ["title"], right: ["search", "inbox"] }`.

  `renderAvatar` now knows whose avatar it draws and where: `AvatarRenderProps` gains
  `official`, `handle`, `placement` (`post`, `comment`, `profile`, `header`, `composer`,
  `reply`, `edit`) and `badges`. New colour `officialName` (defaults to `textPrimary`) for an
  official account's name on posts, comments and its profile.

  Migration:

  - `headerLayout` is gone. `{ left: ["search"], title: { image: LOGO, position: "center", accessibilityLabel: "App" }, right: ["inbox", "profile"] }`
    becomes `header={{ left: ["search"], center: [{ logo: LOGO, width: 160, accessibilityLabel: "App" }], right: ["inbox", "profile"] }}`.
    A logo is 32 high and square unless you set `width` (the old title image was a 160 × 32
    box); `title: "left"` becomes `left: [..., "title"]`; `title: false` is an empty center.
  - The old `header?: ReactNode` (a node above the row) is removed: put it above the screen.
  - `FeedHeaderLayout`, `FeedHeaderButton`, `FeedHeaderTitle` and `DEFAULT_FEED_HEADER_LAYOUT`
    are replaced by `FeedHeaderConfig`, `FeedHeaderItem`, `FeedHeaderBackground` and
    `DEFAULT_FEED_HEADER`.
  - A custom `renderAvatar` keeps working; it simply receives more props.

  **community-core.** Exports the `MemberBadges` / `MemberBadgeData` types (filled by the
  badges module in a later change).

- 0546358: `renderInboxRow`'s third argument grows from `{ unread }` to `{ unread, open, parts }`:
  `open()` does what tapping the built-in row does (opens the post, marks it read), and
  `parts` (`icon`, `title`, `excerpt`, `timeLabel`) are the built-in row's pieces, so a host
  can draw a row of its own design that still opens the post. `InboxRowMeta` and
  `InboxRowParts` are exported. Existing renderers keep working.
- 093fc9f: **Member badges (breaking).** The streaks module becomes a generic badges module: each
  app declares its badges (`modules.badges: { [id]: { placements } }`, placements `post`,
  `comment`, `profile`), computes their data on the device (`host.getBadges()`), and draws
  them with `renderMemberBadge({ id, data, placement, size })`. Each badge gets its own
  visibility toggle in the profile sheet; a hidden badge never leaves the database.
  `STREAK_BADGES` + `streakBadgeData()` reproduce the streak (current streak on posts and
  the profile, best streak on the profile) with the built-in pills.

  New backend module `badges` (`profiles.badges`, `hidden_badges`, generated
  `visible_badges`). `streaks/002_to_badges` moves an existing streak install over and keeps
  the legacy columns in step both ways, so app builds still on the streaks API keep working;
  a later `streaks/003` drops them.

  Migration:

  - DB: `npx @rocapine/community upgrade` brings `badges/001` and `streaks/002` to an install
    that has streaks (badges first); push them before shipping the new client.
  - Config: `modules.streaks: true` → `modules.badges: STREAK_BADGES`;
    `host.getStreak: () => s` → `host.getBadges: () => streakBadgeData(s ?? { startedAt: null, bestDays: 0 })`.
  - UI: `renderStreakPill` → `renderMemberBadge` (`id` is `streak` or `bestStreak`; the day
    count is `streakDays(data.since)` or `data.days`; the old `tier` is `streakTier(days)` and
    `label` is `useT()("streak.days", { count: days })`; `defaultMemberBadge(p)` draws the
    built-in pill). `StreakPillRenderProps` is gone. The renderer is called as a plain
    function: no hooks in it, return an element.
  - Data: `FeedPost.authorStreakStartedAt` → `authorBadges`; `CommunityProfile`
    `streakStartedAt` / `bestStreakDays` / `showStreak` / `showBestStreak` → `badges` /
    `hiddenBadges`; `ThreadComment.authorBadges` is new. Raw rows: `PostRow.author_streak`
    (`{ visible_streak_started_at }`) → `author_badges` (`{ visible_badges }`), and
    `buildFeedSelect`'s fifth argument `streaks` → `badges`.
  - `setStreakVisibility` / `useSetStreakVisibility` → `setBadgeVisibility` /
    `useSetBadgeVisibility({ key, visible })`.
  - Strings: `profile.streak` → `badge.streak.label`, `profile.bestStreak` →
    `badge.bestStreak.label`, `profile.showStreak` → `badge.streak.toggle`,
    `profile.showBestStreak` → `badge.bestStreak.toggle`, `profile.streakHelper` →
    `profile.badgesHelper` (now generic copy); new `profile.badges` (the toggles' header).
    Rename your overrides. A badge's switch reads `badge.<id>.toggle`, else its
    `badge.<id>.label`, else its id.
  - `renderAvatar` now receives the member's `badges`.

- b548fae: Reactions: `modules.reaction` takes an optional `label` shown next to the icon (e.g.
  `{ key: "yum", label: "Yum" }`), coloured `colors.reaction` when active. `PostSlotContext`
  gains `reaction: { active, count, toggle }`, so a `renderReactionButton` can draw its own
  button without re-implementing the toggle (`toggle` honours `onPressReaction`).
- a211874: `theme.typography`: nine named text roles (`display`, `title`, `heading`, `body`,
  `bodySmall`, `label`, `meta`, `caption`, `input`), each a complete text style derived
  from `fonts` and `fontWeights`. A host overrides one role field by field, e.g. a header
  title font of its own: `typography: { title: { fontFamily: "Orbitron-Bold" } }`.

  Every component now draws with a role instead of a literal size. The 14 sizes used
  before snap to the role scale; most text moves by 0.5 pt at most. A few move by 1 pt: the
  inbox title (19 → 20), the composer's Cancel (16 → 15), and some 11 pt labels (→ 12).

  Migration: nothing to do. A theme that only sets `fonts` renders the same families as
  before.

### Patch Changes

- 23325ae: The translation caption names a regional source language by its base language: a post
  the translator detected as `pt-BR` now reads "Traducido del portugués" instead of
  "Traducido del pt-BR". A code whose base language has no name either still shows as is.
- Updated dependencies [b69bf37]
- Updated dependencies [6672084]
- Updated dependencies [6092dbb]
- Updated dependencies [05caa2d]
- Updated dependencies [e3661c7]
- Updated dependencies [07c33a5]
- Updated dependencies [093fc9f]
- Updated dependencies [b548fae]
  - @rocapine/community-core@0.15.0

## 0.14.2

### Patch Changes

- 6e9a1d1: `beforeSubmitComment` gets a second argument, `{ presentModal }`: a gate that shows its own sheet (e.g. sign-in) opens it through `presentModal`, which closes the thread first and opens the sheet once it is gone. iOS can't present a Modal over the thread's, so opening it directly showed nothing and left an invisible layer that froze the app. Resolving `true` after the sheet still sends the comment. New exported types: `CommentGate`, `PresentModal`.

## 0.14.1

### Patch Changes

- 2f37a10: `renderStreakPill` on `CommunityUIProvider`: the host draws every streak pill (post header, profile) from `{ days, tier, size, label }`, the tier and the localized label already resolved, nothing under one day. Without it the pill stays the flame and label on a tint of the tier colour. `StreakPillRenderProps` is exported.

## 0.14.0

### Minor Changes

- f8e5abd: Streaks module (`modules.streaks`, `streaks/001_streaks.sql`): the host's streak on each profile, mirrored from `host.getStreak` by `syncProfileFromHost`. A bronze / silver / gold pill (under 30 days, 30 to 90, beyond 90; theme `streakBronze`/`streakSilver`/`streakGold`, icon role `streak`) sits under the author's name on posts, the profile shows the streak and the best streak, and the owner's edit sheet has two toggles (`useSetStreakVisibility`). A hidden value never leaves the database: readers only see generated `visible_*` columns.

  `PostSlots.onPressReaction`: a tap on the reaction calls the host instead of toggling (e.g. open a flow that reacts at its end with `useReactToPost`).

  `CommunityPost` `preview`: a read-only quote of the post (a small avatar beside the author line, three lines full width below with View more; no streak, menu, footer, image or poll), for a host's own reaction sheet.

  Every community sheet now opens to the same height, right under the status bar / Dynamic Island (`snapTo="full"` is 100% below the top inset; the rules and report sheets use it too), and still pans down to close. A tap on a post's streak pill opens the author's profile. The profile sheet's streak toggles sit under the bio, with room above Save, and stay visible in both themes.

  Fix: the feed's topic tabs no longer scroll vertically (the slot's hairline border ate into the row's height).

### Patch Changes

- Updated dependencies [f8e5abd]
  - @rocapine/community-core@0.14.0

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

### Patch Changes

- Updated dependencies [d64bea8]
  - @rocapine/community-core@0.13.0

## 0.12.2

### Patch Changes

- 305c3e7: `CommunityFeedScreen` takes a `headerLayout` prop: pick the header buttons on each side (`profile`, `search`, `inbox`) and show the "Community" title on the left, in the center, or not at all. The new default (`DEFAULT_FEED_HEADER_LAYOUT`) is the user's avatar on the left (opens their own profile), the title centered, and search then inbox on the right — apps that kept the old default header now get this one. The header buttons get the same press scale as the rest of the community. New string `a11y.myProfile` in all 13 catalogs.

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
