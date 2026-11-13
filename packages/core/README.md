# @rocapine/community-core

Headless data layer for the Community SDK: config, models, Supabase queries,
React Query hooks, anonymous identity, and the analytics event seam. No
React Native, no components, no store, no router, no analytics provider.

```bash
npm install @rocapine/community-core
```

Peer dependencies: `react >=18`, `@supabase/supabase-js ^2.45.0`,
`@tanstack/react-query ^5.50.0`.

## `CommunityConfig`

The single configuration object passed to `<CommunityProvider config={...}>`:

```ts
import type { CommunityConfig } from "@rocapine/community-core";

const config: CommunityConfig = {
  // Connection — injected, never created by the SDK.
  supabase: mySupabaseClient, // or `null` for degraded mode, see below

  // Product vocabulary
  appName: "My App", // pushes, inbox, broadcast fallback title
  // Optional. Every profile starts as "<label> <digits>" / @<handle>-<digits>,
  // assigned on the first launch in the user's language and never re-translated.
  // `label` may be a function of the host locale; defaults to "User" / "user".
  defaultName: {
    label: (locale) => (locale.startsWith("fr") ? "Membre" : "Member"),
    handle: "member",
  },

  // Topics — nothing hardcoded. `id` resolves to `topics.<id>` in the UI
  // package's i18n catalog (see packages/ui/README.md); the app supplies
  // the key for any topic it invents. Everyone reads an `adminOnly: true`
  // topic; only `is_admin` profiles post in it (the UI's rule, not RLS).
  // `from` / `until` make an event topic: its tab comes right after "All", and
  // only inside the window (device clock; a bare date is local midnight,
  // `until` excluded). Outside it the tab is gone, its posts stay in "All".
  topics: [
    { id: "nnn", from: "2026-11-01", until: "2026-12-01" },
    { id: "general" },
    { id: "question" },
    { id: "news", adminOnly: true },
  ],

  // Opt-in modules — MUST mirror what the CLI installed on the backend.
  modules: {
    polls: true,
    push: false,
    inbox: true,
    reaction: { key: "cheer" }, // or `false` to disable the reaction module
    // posts/comments/poll labels translated at publication into these
    // locales — must equal the backend's COMMUNITY_TRANSLATION_LOCALES.
    // Absent or `false` ⇒ every query and screen behaves as before.
    translation: { locales: ["en", "es-419"] },
    // One photo per post and per comment. Needs the backend `images` module
    // and, in the UI package, expo-image-manipulator. Absent or `false` ⇒
    // every query and screen behaves as before.
    images: true,
    // Online dots and count. Needs the backend `presence` module and a heartbeat
    // run by the host: `startPresenceHeartbeat(cfg, AppState)`. All fields optional:
    // minCount (0), collapseAfterMs (3000, or false).
    presence: {},
  },

  // Optional. Characters a post may hold (composer cap and ring): defaults to
  // 500, never above the database's limit (`POST_MAX_LENGTH`).
  postMaxLength: 1000,
  // Optional. When an inbox item counts as read: "open" (default) reads
  // everything when the notification center opens; "tap" reads an item once
  // tapped, and the center offers "mark all as read".
  inboxReadMode: "tap",
  // Optional. Pinned posts a topic may hold at once (default 1): an admin
  // pinning one more is warned instead.
  maxPinnedPerTopic: 2,
  // Optional, push module. Every admin post is pushed to every member, and so listed
  // in their notification center (default false: the admin picks per post).
  adminPostsNotifyAll: true,

  // Host adapters — every field optional, no-op defaults.
  host: {
    getDisplayName: () => myUserStore.firstName,
    getAnalyticsIds: () => ({ amplitudeId: "...", revenuecatId: "..." }),
    onEvent: (name, props) => myAnalytics.track(name, props),
    rulesAcceptance: {
      get: async () => myStore.acceptedRules,
      set: async () => myStore.setAcceptedRules(true),
    },
    onContentPublished: () => myReviewGate.arm(),
    getLocale: () => "en",
  },
};
```

### Degraded mode

`supabase: null` is a first-class, supported state (not an error path): every
hook returns empty/loading-false states, `useCommunityConfig()`'s
`requireClient()` throws a `CommunityDisabledError` that hooks catch
internally, and exactly one `console.warn` is logged the first time a query
actually needs the client. The app boots and renders normally with no
backend configured — the pattern `examples/expo-app` uses when
`EXPO_PUBLIC_SUPABASE_URL`/`_KEY` are unset.

### Host adapters (`CommunityHostAdapters`)

All optional, all default to a no-op:

| Field                | Signature                                                | Purpose                                                                                                                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDisplayName`     | `() => string \| null`                                   | Feeds the display name shown for the current user before their community username is set                                                                                                                                                                                                                            |
| `getAnalyticsIds`    | `() => { amplitudeId?: string; revenuecatId?: string }`  | Cross-referencing ids attached where the host wants them                                                                                                                                                                                                                                                            |
| `onEvent`            | `(name: string, props: Record<string, unknown>) => void` | **The only analytics seam.** Every product event goes through this; the SDK never depends on any analytics provider. Never throws through to the UI even if the adapter itself throws                                                                                                                               |
| `rulesAcceptance`    | `{ get(): Promise<boolean>; set(): Promise<void> }`      | Persists whether the user has accepted the one-time community guidelines sheet                                                                                                                                                                                                                                      |
| `onContentPublished` | `() => void`                                             | Fired after a post/comment is successfully published (e.g. to arm a review-gate)                                                                                                                                                                                                                                    |
| `getBadges`          | `() => MemberBadges \| null`                             | Badges module: this member's badges, keyed by the ids in `modules.badges` (e.g. `streakBadgeData({ startedAt, bestDays })`), mirrored to the profile by `syncProfileFromHost` (call it again on app foreground). Synchronous — read an already-warmed cache. `null`: nothing to mirror                              |
| `getLocale`          | `() => string`                                           | The app's language. Resolved against `modules.translation.locales` to choose the language content is read in (`readerLocale`), and mirrored to `profiles.locale` by `syncProfileFromHost` so pushes arrive in each recipient's language. Distinct from the UI package's `translations.locale` prop (interface copy) |

### Presence (`modules.presence`)

Online = in the foreground within the grace window (the caller always counts as online): 5 minutes by default, a per-project
backend setting, not a client option, so members can't vary it to probe when someone was
last active. Change it from the SQL editor (service role):
`select public.presence_set_grace_minutes(10);` (1 to 60). The host runs the heartbeat once,
with the resolved config: `useEffect(() => startPresenceHeartbeat(cfg, AppState), [cfg])`
(`AppState` from `react-native`; the config from `useCommunityConfig()` is stable, a config rebuilt on every render would restart the heartbeat). It beats in the foreground, once more on background,
and never signs in anonymously: no session, no beat. `presenceSettings(cfg)` returns the
resolved settings, or `null` with the module off. Hooks: `useOnlineCount()`,
`useIsOnline(userId)`, `usePresenceVisible()` and `useSetPresenceVisible()` (the member's
"show when I'm online" switch; event `community_presence_visibility_changed`,
props `{ visible }`). RPCs never return a timestamp; blocked members never see each
other's dot; hidden members still count.

### Feed row extension point (`CommunityConfig.feed`)

Optional, defaults to `{}` — omitting `feed` entirely keeps today's behavior
byte-identical. It exists for a host that stores extra columns on `posts` the
shared schema doesn't know about (e.g. Nightward's `posts.seed_likes`
top-up), without forking the query or mapping layer:

```ts
import type { CommunityConfig } from "@rocapine/community-core";

const config: CommunityConfig = {
  // ...supabase, appName, defaultName, topics, modules...
  feed: {
    // Appended to the posts `select` in every posts-table query
    // (fetchFeedPage, fetchUserPosts, searchPosts). Only `[a-z0-9_]+`
    // column names are accepted — anything else (a relation embed, a rename,
    // a stray `*`) is dropped with a `console.warn` instead of reaching the
    // query string.
    extraPostColumns: ["seed_likes"],
    // Runs last inside `mapPostRow`, given the mapped post and the raw row
    // (including any extraPostColumns) it came from.
    transformPost: (post, row) => ({
      ...post,
      likeCount: post.likeCount + (Number(row.seed_likes) || 0),
    }),
  },
};
```

Two things worth knowing:

- `transformPost` only runs on rows the SDK fetched from the backend. The
  optimistic post shown right after `createPost` has no raw row yet, so it
  renders untransformed until the next refetch swaps in the server-mapped
  (and transformed) version — acceptable since the gap is a moderation-queue
  window, not a rendered-forever state.
- `fetchThread` queries `comments`, not `posts` — `extraPostColumns` and
  `transformPost` don't apply there; a thread's parent post is the
  already-fetched, already-transformed `FeedPost` the caller passes in, never
  re-fetched.

### Event names (`COMMUNITY_EVENTS`)

```ts
import { COMMUNITY_EVENTS, type CommunityEventName } from "@rocapine/community-core";
```

`COMMUNITY_EVENTS` is a frozen map of stable event-name strings — `opened`,
`rulesAccepted`, `postPublished`, `pollVoted`, `threadOpened`, `postLiked`,
`commentPublished`, `profileOpened`, `profileUpdated`, `reactionAdded`,
`userReported`, `userBlocked`, `userUnblocked`, `contentDeleted`, `inboxOpened`,
`translationToggled` (`community_translation_toggled`, props `{ postId | commentId, to: "original" | "translation" }`) — forwarded to
`host.onEvent` by the exported `emitEvent(cfg, name, props)` helper. `postPublished` and `commentPublished` carry
`hasImage: boolean` (alongside `hasPoll`). Route or
ignore these in your own tracking plan; nothing else in the package calls an
analytics provider directly.

### Schema drift check

`CommunityProvider` calls a dev-only diagnostic on mount that reads
`community_meta.schema_version` from the backend and warns (never throws) if
it doesn't match `REQUIRED_SCHEMA_VERSION` (currently `1`, exported from the
package). This only runs when React Native's `__DEV__` is true — it never
runs in production and is silent in degraded mode.

## What else is exported

- **Models & limits**: `PostRow`, `CommentRow`, `ProfileRow`, `FeedPost`,
  `ThreadComment`, `CommunityProfile`, `FeedPoll`, `PollData`,
  `ReactionData`, and DB-mirroring constants `FEED_PAGE_SIZE`,
  `POST_MAX_LENGTH` (2000), `COMMENT_MAX_LENGTH` (1000), `POLL_MIN_OPTIONS`
  (2), `POLL_MAX_OPTIONS` (4), `POLL_OPTION_MAX_LENGTH` (60) — client-side
  mirrors of the backend's check constraints. `FeedPost.translation` /
  `ThreadComment.translation` are `{ text, sourceLocale } | null` (embedded
  only when the translation module is on and the reader locale resolves);
  `text`/`content` always stay the original. Poll options carry
  `translatedLabel: string | null` alongside the original `label`.
  `FeedPost.image` / `ThreadComment.image` are `PostImage | null`
  (`{ url, width, height }`; `url` is a local `file://` on an optimistic item)
  — always `null` unless `modules.images` is on. **They are required fields:**
  a host that builds `FeedPost`/`ThreadComment` literals by hand (tests,
  fixtures, mocks) must add `image: null`. `LocalImage` is the same shape: a
  re-encoded local JPEG ready to upload. `mapImage(row, imageBase)` turns the
  `image_path`/`image_width`/`image_height` columns into a `PostImage`.
- **Locale** (`locale.ts`): `readerLocale(cfg)` — the locale translations
  are read in (the host's `getLocale()` resolved against
  `modules.translation.locales`), or `null` when the module is off or
  nothing resolves. `languageOf(locale)` — the bare-language prefix of a
  locale tag (e.g. `"es-419"` → `"es"`).
- **Identity**: `ensureIdentity()`, `resetIdentity()`, `syncProfileFromHost()`
  — anonymous Supabase auth session management.
- **Queries** (`service.ts`): `fetchFeedPage`, `countNewPosts`, `fetchProfile`,
  `fetchUserPosts`, `searchPosts`, `fetchThread`, `createPost`, `votePoll`,
  `createComment`, `moderateOne`, `setLike`, `setReaction`,
  `fetchReactionSummaries`, `reportContent`, `blockUser`, `unblockUser`,
  `fetchBlockedMembers` (whom I blocked; a block hides both members from each
  other, so this list is the way back), `isProfileUnavailable(error)` (a profile
  fetch found no row: blocked either way, or gone), `deleteOwnPost`,
  `deleteOwnComment`, `updateProfile`, `uploadAvatar`, `uploadPostImage`
  (re-encoded JPEG → the public `post-images` bucket, `POST_IMAGES_BUCKET`,
  under the caller's own folder; `createPost` / `createComment` take its
  result, and `useCreatePost` / `useCreateComment` take an `image?: LocalImage`
  and do both steps), `buildFeedSelect`
  (pure helper behind `feed.extraPostColumns`, see below).
- **React Query hooks** (`hooks.ts`): `useCommunityFeed`, `useSearchPosts`,
  `useNewPostsCount`, `useCommunityUnseenCount`, `useThread`, `usePost` (one
  post by id, for a thread opened on a post no list has loaded), `useProfile`,
  `useUserPosts`, `useMyUid`, `useNotificationPreferences` (push module: the
  caller's `notify_*` flags), `useUpdateProfile`, `useCreatePost`,
  `useCreateComment` (takes `parentId` to reply to a comment),
  `useToggleLike`, `useToggleCommentLike`, `useVotePoll`, `useReactToPost`,
  `useReport`, `useBlockUser`, `useUnblockUser`, `useBlockedMembers`,
  `useDeleteContent`.
- **Inbox** (opt-in via `modules.inbox`): `fetchInbox`, `markInboxSeen`,
  `markInboxItemRead`, `isUnread`, `unreadCount`, `localizeExcerpts` (swaps a
  notification's excerpt for its reader-locale translation when one is
  available), and hooks `useNotificationInbox`, `useUnreadNotificationCount`,
  `useMarkInboxSeen`, `useMarkInboxItemRead`, `useMarkPostNotificationsRead`
  (reads a post's unread items, e.g. when a push about it is tapped: pass the
  push's `postId` and `kind`). The center is the history of the community's pushes:
  every push has its item (likes and reactions are one item each, where the push
  groups them), and an admin post is listed only once it was sent to everyone. Push
  settings and a missing permission only silence the phone. With the app open, your
  notification handler should hide a community push's banner (`data.route ===
"/community"`) and refetch the inbox: the item and its unread badge then show in
  the app instead.
- **`timeAgo(iso, nowMs)`** — hardcoded-English relative-time formatting, kept for
  back-compat. **`timeAgoParts(iso, nowMs)`** — the language-free unit+value
  decomposition the UI package actually localizes through its own catalog
  (see `formatTimeAgo` in `@rocapine/community-ui`).

See `src/index.ts` for the exhaustive, authoritative export list.
