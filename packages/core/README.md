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
  anonymousAuthorFallback: "Someone", // shown when an author has no username yet

  // Topics — nothing hardcoded. `id` resolves to `topics.<id>` in the UI
  // package's i18n catalog (see packages/ui/README.md); the app supplies
  // the key for any topic it invents. `officialOnly: true` topics (e.g.
  // "news") are writable only by `is_official` profiles — enforced by RLS.
  topics: [{ id: "general" }, { id: "question" }, { id: "news", officialOnly: true }],

  // Opt-in modules — MUST mirror what the CLI installed on the backend.
  modules: {
    polls: true,
    push: false,
    inbox: true,
    reaction: { key: "cheer" }, // or `false` to disable the reaction module
  },

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

| Field                | Signature                                                | Purpose                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDisplayName`     | `() => string \| null`                                   | Feeds the display name shown for the current user before their community username is set                                                                                              |
| `getAnalyticsIds`    | `() => { amplitudeId?: string; revenuecatId?: string }`  | Cross-referencing ids attached where the host wants them                                                                                                                              |
| `onEvent`            | `(name: string, props: Record<string, unknown>) => void` | **The only analytics seam.** Every product event goes through this; the SDK never depends on any analytics provider. Never throws through to the UI even if the adapter itself throws |
| `rulesAcceptance`    | `{ get(): Promise<boolean>; set(): Promise<void> }`      | Persists whether the user has accepted the one-time community guidelines sheet                                                                                                        |
| `onContentPublished` | `() => void`                                             | Fired after a post/comment is successfully published (e.g. to arm a review-gate)                                                                                                      |
| `getLocale`          | `() => string`                                           | Selects which locale-specific behavior the _host_ wants (distinct from the UI package's own `translations.locale` prop)                                                               |

### Feed row extension point (`CommunityConfig.feed`)

Optional, defaults to `{}` — omitting `feed` entirely keeps today's behavior
byte-identical. It exists for a host that stores extra columns on `posts` the
shared schema doesn't know about (e.g. Nightward's `posts.seed_likes`
top-up), without forking the query or mapping layer:

```ts
import type { CommunityConfig } from "@rocapine/community-core";

const config: CommunityConfig = {
  // ...supabase, appName, anonymousAuthorFallback, topics, modules...
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
`userReported`, `userBlocked`, `contentDeleted`, `inboxOpened` — forwarded to
`host.onEvent` by the exported `emitEvent(cfg, name, props)` helper. Route or
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
  mirrors of the backend's check constraints.
- **Identity**: `ensureIdentity()`, `resetIdentity()`, `syncProfileFromHost()`
  — anonymous Supabase auth session management.
- **Queries** (`service.ts`): `fetchFeedPage`, `countNewPosts`, `fetchProfile`,
  `fetchUserPosts`, `searchPosts`, `fetchThread`, `createPost`, `votePoll`,
  `createComment`, `moderateOne`, `setLike`, `setReaction`,
  `fetchReactionSummaries`, `reportContent`, `blockUser`, `deleteOwnPost`,
  `deleteOwnComment`, `updateProfile`, `uploadAvatar`, `buildFeedSelect`
  (pure helper behind `feed.extraPostColumns`, see below).
- **React Query hooks** (`hooks.ts`): `useCommunityFeed`, `useSearchPosts`,
  `useNewPostsCount`, `useCommunityUnseenCount`, `useThread`, `useProfile`,
  `useUserPosts`, `useMyUid`, `useUpdateProfile`, `useCreatePost`,
  `useCreateComment`, `useToggleLike`, `useVotePoll`, `useReactToPost`,
  `useReport`, `useBlockUser`, `useDeleteContent`.
- **Inbox** (opt-in via `modules.inbox`): `fetchInbox`, `markInboxSeen`,
  `unreadCount`, and hooks `useNotificationInbox`,
  `useUnreadNotificationCount`, `useMarkInboxSeen`.
- **`timeAgo(iso)`** — hardcoded-English relative-time formatting, kept for
  back-compat. **`timeAgoParts(iso, nowMs)`** — the language-free unit+value
  decomposition the UI package actually localizes through its own catalog
  (see `formatTimeAgo` in `@rocapine/community-ui`).

See `src/index.ts` for the exhaustive, authoritative export list.
