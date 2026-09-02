# Community SDK Implementation Plan (repo + packages + CLI + backend, spec §7 steps 1-2)

> Historical document: this is the task-by-task plan that built this repo, imported here for provenance alongside `docs/design-spec.md`. All tasks below were executed and are reflected in the current packages, `supabase/`, `examples/expo-app` and `docs/` — the checkbox states are kept as originally written (planning-time, all unchecked) rather than retroactively edited. It is not kept up to date as the SDK evolves; for current behavior, see the package READMEs and `docs/compat.md`.

**Goal:** Build and publish `0.x` of the public community SDK — monorepo with `@rocapine/community-core`, `@rocapine/community-ui`, the `@rocapine/community` CLI and the versioned Supabase backend — consolidated from the Rocacommu mold plus Eve's drift and Nightward's improvements.

**Architecture:** npm monorepo, two runtime packages (headless core on Supabase + React Query; themable UI on top) configured through a single `CommunityConfig` given to a `CommunityProvider`. Backend ships as module-organized SQL migrations + Deno Edge Functions, installed into consumer apps by a CLI (`init`/`upgrade`/`adopt`) that substitutes URL/key placeholders and tracks a manifest.

**Tech Stack:** TypeScript strict, npm workspaces, tsc builds (CJS + d.ts), vitest, changesets (linked versioning), React Native / Expo peer deps, Supabase (Postgres + Edge Functions/Deno), commander (CLI).

**Spec:** `docs/design-spec.md` (this repo). This plan implements spec §7 steps 1-2 only. Nightward and Eve migrations (§7 steps 3-5) get their own plans in their own repos after `0.x` ships.

## Source material (read access required)

- **Mold (baseline):** the `Rocacommu/sdk/` mold repo — `client/` (RN reference with seam files `theme.tsx`, `ui.tsx`, `community-host.ts`, `community-analytics.ts`, `constants/community.ts`, `lib/supabase.ts`, `lib/haptics.ts`), `migrations/2026072900000{1..7}_community_*.sql`, `functions/` (7 + `_shared/`), `SKILL.md`, `README.md`.
- **Eve drift to backport:** the Eve's Rhythm app repo — `services/community.ts` (setPrayed, post_prayer_summary batching), `hooks/useCommunity.ts` (usePrayForPost, useCommunityUnseenCount), `components/app/community/ComposerCard.tsx`, `services/notification-center.ts` + `hooks/useNotificationCenter.ts`, `supabase/migrations/20260812090000_post_prayers.sql`, `20260813090000_notifications_inbox.sql`, `20260813160000_official_posts_inbox.sql`, `supabase/functions/notify-prayer/`, `i18n/*/community.json` (7 locales).
- **Nightward improvements:** clone `Rocapine/nightward` (shallow) — nullable Supabase client pattern (`lib/supabase.ts`, `requireClient()` in `services/community.ts`), key-based i18n (`i18n/en/community.json`), storeless host seam (`lib/community-host.ts` → `hooks/useCommunityHost.ts`), `docs/community-setup.md` runbook.

## Global Constraints

- New repo (GitHub `Rocapine/community-sdk` — name was a §9 placeholder at spec time, confirmed with Martin before creating the GitHub repo).
- npm packages: `@rocapine/community-core`, `@rocapine/community-ui`, `@rocapine/community` (CLI). Linked versioning, start at `0.1.0`.
- TypeScript strict, `noImplicitAny`. Prettier: double quotes, trailing commas, print width 100 (Rocapine convention).
- core peer deps ONLY: `react >=18`, `@supabase/supabase-js ^2`, `@tanstack/react-query ^5`. ui peer deps add: `react-native`, `react-native-reanimated`, `expo-image`, `expo-haptics`, `phosphor-react-native`.
- FORBIDDEN in packages: zustand, expo-router, react-navigation, any analytics SDK, i18next. Analytics = `onEvent` callback; navigation = callbacks; i18n = internal `t()`.
- `supabase: null` in config must never crash: hooks return empty/idle states, mutations reject with `CommunityDisabledError`, exactly one `console.warn` per session.
- No gendered/app-specific copy in package code or default catalogs: no "sister", "Eve", "prayer" (the word "prayer" may appear only in comments referencing Eve as the origin of the reaction module).
- All SQL that embeds project URL/anon key uses `__SUPABASE_PROJECT_URL__` / `__SUPABASE_ANON_KEY__` placeholders plus the guard block (Task 16).
- License MIT (§9: not yet confirmed — put MIT, flag in the release checklist).
- Commit after every task minimum; conventional commits.

## File structure (target repo)

```
community-sdk/
├── package.json (with a "workspaces" field)  tsconfig.base.json  .prettierrc  .changeset/  .github/workflows/ci.yml  LICENSE
├── packages/core/src/
│   ├── index.ts            (public exports)
│   ├── config.ts           (CommunityConfig, defaults, CommunityDisabledError)
│   ├── provider.tsx        (CommunityProvider, useCommunityConfig)
│   ├── events.ts           (COMMUNITY_EVENTS, emit helper)
│   ├── models.ts           (from mold lib/community.ts)
│   ├── time.ts             (from mold lib/community-feed.ts)
│   ├── identity.ts         (from mold lib/community-identity.ts)
│   ├── service.ts          (from mold services/community.ts + Eve reaction)
│   ├── inbox-service.ts    (from Eve services/notification-center.ts)
│   ├── hooks.ts            (from mold hooks/useCommunity.ts + Eve drift)
│   ├── inbox-hooks.ts      (from Eve hooks/useNotificationCenter.ts)
│   ├── schema-check.ts     (community_meta dev check)
│   └── __tests__/          (config.test.ts, models.test.ts, time.test.ts, events.test.ts, schema-check.test.ts)
├── packages/ui/src/
│   ├── index.ts  theme.ts  ThemeProvider.tsx  i18n.ts  Sheet.tsx
│   ├── locales/{en,es-ES,es-419,it,pl,pt-PT,pt-BR}.ts
│   ├── components/ (CommunityPost, PollBlock, NoticeCard, ComposerCard, RulesSheet, ReportSheet)
│   ├── screens/ (CommunityFeedScreen, ThreadSheet, ProfileScreen, ProfileEditSheet, NotificationInboxScreen)
│   └── __tests__/ (theme.test.ts, i18n.test.ts)
├── packages/cli/src/ (index.ts, manifest.ts, substitute.ts, commands/{init,upgrade,adopt}.ts, __tests__/)
├── supabase/
│   ├── migrations/core/  push/  polls/  inbox/  reaction/
│   └── functions/ (_shared/, moderate-one, daily-moderation, update-profile, notify-comment, notify-like, notify-reaction, report-to-slack, broadcast-post)
├── examples/expo-app/
└── docs/ (integration-skill.md, backend-runbook.md, compat.md)
```

---

### Task 1: Repo scaffold and tooling

**Files:**

- Create: repo root — `package.json` (with a "workspaces" field), `tsconfig.base.json`, `.prettierrc`, `.gitignore`, `LICENSE` (MIT), `.github/workflows/ci.yml`, `packages/{core,ui,cli}/package.json`, `packages/{core,ui,cli}/tsconfig.json`, `packages/{core,ui,cli}/src/index.ts` (empty export), `.changeset/config.json`

**Interfaces:**

- Produces: workspace where `npm run typecheck --workspaces --if-present`, `npm run test --workspaces --if-present`, `npm run build --workspaces --if-present` run green; later tasks add code under `packages/*/src`.

- [ ] **Step 1: Initialize repo and workspace**

```bash
mkdir -p community-sdk && cd community-sdk && git init -b main
npm init
```

Root `package.json`:

```json
{
  "name": "community-sdk",
  "private": true,
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "release": "npm run build && changeset publish"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.0",
    "prettier": "^3.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Root `package.json`'s `"workspaces"` field:

```json
["packages/*", "examples/*"]
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "jsx": "react-native",
    "declaration": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.prettierrc`: `{ "printWidth": 100, "trailingComma": "all" }` (double quotes are Prettier's default).

- [ ] **Step 2: Package manifests**

Each `packages/<p>/package.json` (adjust `name`; core shown):

```json
{
  "name": "@rocapine/community-core",
  "version": "0.0.0",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": ["lib"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.json --outDir lib --noEmit false",
    "test": "vitest run"
  },
  "peerDependencies": {
    "react": ">=18",
    "@supabase/supabase-js": "^2.45.0",
    "@tanstack/react-query": "^5.50.0"
  },
  "devDependencies": {
    "react": "19.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "@tanstack/react-query": "^5.50.0",
    "@types/react": "^19.0.0"
  }
}
```

`@rocapine/community-ui` adds peers `react-native`, `react-native-reanimated`, `expo-image`, `expo-haptics`, `phosphor-react-native` (all as devDeps too for typecheck) and depends on `"@rocapine/community-core": "workspace:*"`. `@rocapine/community` (cli) has no peers, deps `commander ^12`, `bin`: `{ "community": "lib/index.js" }`.

Each `packages/<p>/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"], "exclude": ["src/**/__tests__"] }`.

- [ ] **Step 3: Changesets + CI**

```bash
npm install && npx changeset init
```

Edit `.changeset/config.json`: `"linked": [["@rocapine/community-core", "@rocapine/community-ui", "@rocapine/community"]]`, `"access": "public"`.

`.github/workflows/ci.yml`:

```yaml
name: CI
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm test && npm run build` — all pass (vitest passes with no test files via `passWithNoTests: true` in a root `vitest.config.ts` shared config; add it).
Commit: `chore: scaffold npm monorepo (core, ui, cli), changesets, CI`

---

### Task 2: core — CommunityConfig contract + CommunityProvider + degraded mode

**Files:**

- Create: `packages/core/src/config.ts`, `packages/core/src/provider.tsx`, `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/config.test.ts`

**Interfaces:**

- Produces (everything later tasks import):

```ts
// config.ts
export type CommunityTopicDef = { id: string; officialOnly?: boolean };
export type CommunityModules = {
  polls: boolean;
  push: boolean;
  inbox: boolean;
  reaction: { key: string } | false;
};
export type CommunityHostAdapters = {
  getDisplayName?: () => string | null;
  getAnalyticsIds?: () => { amplitudeId?: string; revenuecatId?: string };
  onEvent?: (name: string, props: Record<string, unknown>) => void;
  rulesAcceptance?: { get(): Promise<boolean>; set(): Promise<void> };
  onContentPublished?: () => void;
  getLocale?: () => string;
};
export type CommunityConfig = {
  supabase: SupabaseClient | null;
  appName: string;
  anonymousAuthorFallback: string;
  topics: CommunityTopicDef[];
  modules: CommunityModules;
  host?: CommunityHostAdapters;
};
export class CommunityDisabledError extends Error {} // message "community backend not configured"
export function resolveConfig(config: CommunityConfig): ResolvedCommunityConfig;
// ResolvedCommunityConfig = CommunityConfig with host defaulted to no-ops and
// helper methods: requireClient(): SupabaseClient (throws CommunityDisabledError,
// warns once per process on first call with null client), composeTopics(): CommunityTopicDef[]
// (topics minus officialOnly), isOfficialTopic(id: string): boolean.

// provider.tsx
export function CommunityProvider(props: {
  config: CommunityConfig;
  children: ReactNode;
}): JSX.Element;
export function useCommunityConfig(): ResolvedCommunityConfig; // throws if no provider
```

- [ ] **Step 1: Write failing tests** — `config.test.ts` with a `makeConfig(overrides)` helper:

```ts
import { describe, expect, it, vi } from "vitest";
import { CommunityDisabledError, resolveConfig } from "../config";

const base = {
  supabase: null,
  appName: "Test App",
  anonymousAuthorFallback: "Someone",
  topics: [{ id: "general" }, { id: "news", officialOnly: true }],
  modules: { polls: false, push: false, inbox: false, reaction: false as const },
};

it("requireClient throws CommunityDisabledError and warns exactly once when supabase is null", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const resolved = resolveConfig({ ...base });
  expect(() => resolved.requireClient()).toThrow(CommunityDisabledError);
  expect(() => resolved.requireClient()).toThrow(CommunityDisabledError);
  expect(warn).toHaveBeenCalledTimes(1);
});

it("composeTopics excludes officialOnly topics", () => {
  expect(
    resolveConfig({ ...base })
      .composeTopics()
      .map((t) => t.id),
  ).toEqual(["general"]);
});

it("isOfficialTopic", () => {
  const r = resolveConfig({ ...base });
  expect(r.isOfficialTopic("news")).toBe(true);
  expect(r.isOfficialTopic("general")).toBe(false);
});

it("host adapters default to safe no-ops", async () => {
  const r = resolveConfig({ ...base });
  expect(r.host.getDisplayName()).toBeNull();
  expect(await r.host.rulesAcceptance.get()).toBe(false);
  r.host.onEvent("community_opened", {}); // must not throw
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -w @rocapine/community-core` → FAIL (module not found).
- [ ] **Step 3: Implement `config.ts`** exactly per the Produces block (module-level `let warned = false` for the single warn; `resolveConfig` returns a frozen object with defaults filled).
- [ ] **Step 4: Implement `provider.tsx`** — `createContext<ResolvedCommunityConfig | null>(null)`; provider memoizes `resolveConfig(config)` on the `config` reference; `useCommunityConfig` throws `new Error("CommunityProvider is missing")` when null. Export both plus all config types from `index.ts`.
- [ ] **Step 5: Run tests + typecheck** → PASS. Commit: `feat(core): CommunityConfig contract, provider, degraded mode`

---

### Task 3: core — models and time (pure logic port)

**Files:**

- Create: `packages/core/src/models.ts`, `packages/core/src/time.ts`
- Test: `packages/core/src/__tests__/models.test.ts`, `__tests__/time.test.ts`
- Source: mold `sdk/client/lib/community.ts` + `lib/community.test.ts`, `lib/community-feed.ts` + test; Eve `lib/community.ts` for the prayer/reaction fields.

**Interfaces:**

- Produces: `FeedPost`, `ThreadComment`, `CommunityProfile`, `FeedPoll`, `mapPostRow`, `mapCommentRow`, `mapProfileRow`, `applyPollVote`, `applyReaction`, `displayName`, `pollPercent`, `newestCreatedAt`, `FEED_PAGE_SIZE = 20`, limits (`POST_MAX_LENGTH = 600`, `COMMENT_MAX_LENGTH = 300`, `POLL_MIN_OPTIONS = 2`, `POLL_MAX_OPTIONS = 4`, `POLL_OPTION_MAX_LENGTH = 60` — verify exact values against mold `constants/community.ts` and keep DB-mirroring comments), `timeAgo(iso: string, nowMs: number): string`.

- [ ] **Step 1: Port tests first.** Copy the mold's `community.test.ts` and `community-feed.test.ts` into `__tests__/`, updating imports to `../models` / `../time` and applying the renames below. Add one new test:

```ts
it("displayName falls back to the configured anonymous name", () => {
  expect(displayName({ username: null, handle: "x" } as CommunityProfile, "Wanderer")).toBe(
    "Wanderer",
  );
});
it("applyReaction increments count and marks reacted, idempotent", () => {
  const post = makePost({ reactionCount: 2, hasReacted: false });
  const once = applyReaction(post);
  expect(once.reactionCount).toBe(3);
  expect(applyReaction(once)).toEqual(once);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Port implementation** from mold `lib/community.ts` with these transformations (each is a seam identified in exploration):
  1. `displayName(profile)` gains a required second param `fallback: string` (was hardcoded `"A sister"` / seam const). All internal callers thread it through.
  2. Prayer naming → reaction naming: `prayerCount` → `reactionCount`, `hasPrayed` → `hasReacted`, `applyPrayer` → `applyReaction` (port the logic from Eve's `lib/community.ts` since the mold predates prayers).
  3. `pollVotesLabel` (hardcoded "vote/votes" in Eve) — DELETE; vote-count formatting moves to ui i18n (Task 10 key `poll.votes`).
  4. Topic type: `CommunityTopic` string-union → plain `string`; `normalizeTopic(raw, topics: CommunityTopicDef[])` keeps unknown-topic rows visible under their raw id.
  5. `timeAgo` ports unchanged into `time.ts`.
- [ ] **Step 4: Run tests** → PASS. Commit: `feat(core): pure models, limits, timeAgo (mold port, reaction generalized)`

---

### Task 4: core — analytics events + anonymous identity

**Files:**

- Create: `packages/core/src/events.ts`, `packages/core/src/identity.ts`
- Test: `packages/core/src/__tests__/events.test.ts`
- Source: mold `sdk/client/services/community-analytics.ts` (event list), `sdk/client/lib/community-identity.ts`; Nightward `services/communityHostService.ts` (storeless pattern).

**Interfaces:**

- Produces:

```ts
// events.ts
export const COMMUNITY_EVENTS = {
  opened: "community_opened",
  rulesAccepted: "community_rules_accepted",
  postPublished: "community_post_published",
  pollVoted: "community_poll_voted",
  threadOpened: "community_thread_opened",
  postLiked: "community_post_liked",
  commentPublished: "community_comment_published",
  profileOpened: "community_profile_opened",
  profileUpdated: "community_profile_updated",
  reactionAdded: "community_reaction_added",
  userReported: "user_reported",
  userBlocked: "user_blocked",
  contentDeleted: "content_deleted",
  inboxOpened: "notification_center_opened",
} as const;
export type CommunityEventName = (typeof COMMUNITY_EVENTS)[keyof typeof COMMUNITY_EVENTS];
export function emitEvent(
  cfg: ResolvedCommunityConfig,
  name: CommunityEventName,
  props?: Record<string, unknown>,
): void; // never throws, catches adapter errors

// identity.ts
export async function ensureIdentity(cfg: ResolvedCommunityConfig): Promise<string | null>; // uid or null in degraded mode; memoized signInAnonymously
export function resetIdentity(): void; // clears memo (call after account login/logout)
export async function syncProfileFromHost(cfg: ResolvedCommunityConfig): Promise<void>; // pushes username (host.getDisplayName), locale (host.getLocale), analytics ids onto profiles row; no-op degraded
```

- [ ] **Step 1: Test** `events.test.ts`: `emitEvent` forwards to `host.onEvent`; swallows a throwing adapter; no-op without adapter. Run → FAIL.
- [ ] **Step 2: Implement `events.ts`** per signature (try/catch around adapter call).
- [ ] **Step 3: Port `identity.ts`** from mold `lib/community-identity.ts`: replace the seam import of the app's supabase client with `cfg.requireClient()` guarded by degraded-mode early return (`if (!cfg.supabase) return null;`), replace direct store/Amplitude reads with `cfg.host.getAnalyticsIds()` / `getDisplayName()` / `getLocale()`. Memoization stays module-level (mold pattern).
- [ ] **Step 4: Tests + typecheck pass.** Commit: `feat(core): event constants + emitEvent, anonymous identity on injected client`

---

### Task 5: core — community service port

**Files:**

- Create: `packages/core/src/service.ts`
- Source: mold `sdk/client/services/community.ts` (baseline), Eve `services/community.ts` (poll/reaction batching, searchPosts), Nightward `services/community.ts` (`requireClient` degradation pattern).

**Interfaces:**

- Consumes: `ResolvedCommunityConfig` (Task 2), models/mappers (Task 3), `ensureIdentity` (Task 4).
- Produces (all take `cfg: ResolvedCommunityConfig` as first arg): `fetchFeedPage(cfg, { topic?, cursor? })`, `countNewPosts(cfg, sinceIso)`, `fetchUserPosts(cfg, userId)`, `searchPosts(cfg, query)`, `fetchThread(cfg, postId)`, `fetchProfile(cfg, userId)`, `createPost(cfg, { topic, body, pollOptions? })` (routes to RPC `create_poll_post` when pollOptions), `createComment(cfg, postId, body)`, `moderateOne(cfg, { kind, id })`, `setLike(cfg, postId, on)`, `setReaction(cfg, postId)`, `votePoll(cfg, postId, optionIndex)`, `reportContent(cfg, …)`, `blockUser(cfg, userId)`, `deleteOwnPost/Comment(cfg, id)`, `updateProfile(cfg, { handle?, bio?, avatarUrl? })` (edge fn), `uploadAvatar(cfg, fileUri)`. Reaction batch: `fetchReactionSummaries(cfg, postIds: string[])` → RPC `post_reaction_summary`; poll batch: RPC `poll_vote_counts`.

- [ ] **Step 1: Port the mold service file.** Transformations: (a) every function takes `cfg` and opens with `const client = cfg.requireClient();` (Nightward pattern — callers in hooks catch `CommunityDisabledError` via `enabled` guards, mutations surface it); (b) `setPrayed` → `setReaction`, `post_prayer_summary` → `post_reaction_summary` (SQL renamed in Task 17), gated on `cfg.modules.reaction`; (c) poll RPCs gated on `cfg.modules.polls` (skip batching, return empty maps when off); (d) module-level constants (page size, bucket name `avatars`) imported from `models.ts` or kept local with the mold's values.
- [ ] **Step 2: Typecheck** (`npm run typecheck -w @rocapine/community-core`) → PASS. (Network layer is exercised by existing mapper tests + the example app; no supabase mock suite in v1, per spec §8.)
- [ ] **Step 3: Commit** `feat(core): community service on injected client, reaction + poll modules gated`

---

### Task 6: core — hooks port

**Files:**

- Create: `packages/core/src/hooks.ts`
- Source: mold `sdk/client/hooks/useCommunity.ts`, Eve `hooks/useCommunity.ts` (usePrayForPost → useReactToPost, useCommunityUnseenCount, optimistic post-moderation reconciliation).

**Interfaces:**

- Consumes: service (Task 5), `useCommunityConfig` (Task 2), `emitEvent`/`COMMUNITY_EVENTS` (Task 4), `applyPollVote`/`applyReaction` (Task 3).
- Produces: `useCommunityFeed(topic?)`, `useSearchPosts(q)`, `useNewPostsCount(sinceIso)`, `useCommunityUnseenCount(lastSeenAtIso)`, `useThread(postId)`, `useProfile(userId)`, `useUserPosts(userId)`, `useMyUid()`, `useUpdateProfile()`, `useCreatePost()`, `useCreateComment()`, `useToggleLike()`, `useVotePoll()`, `useReactToPost()`, `useReport()`, `useBlockUser()`, `useDeleteContent()`. Query keys stay `["community", ...]` (mold convention). Every mutation emits its `COMMUNITY_EVENTS` name via `emitEvent`; `useCreatePost`/`useCreateComment` call `cfg.host.onContentPublished()` on success.

- [ ] **Step 1: Port** the mold hooks file; thread `const cfg = useCommunityConfig();` through, replace direct analytics imports with `emitEvent`, replace the mold's host-seam imports (`community-host.ts`) with `cfg.host.*`. Backport from Eve: `useReactToPost` (rename of `usePrayForPost`, optimistic `applyReaction`), `useCommunityUnseenCount` (param `lastSeenAtIso` instead of reading Eve's store), moderation reconciliation in `useCreatePost`/`useCreateComment` (pending → visible/rejected polling, mold may already have it — diff both and keep Eve's newer version).
- [ ] **Step 2: Degraded mode**: queries pass `enabled: cfg.supabase !== null && <existing conditions>`; verify by grepping every `useQuery` for the guard.
- [ ] **Step 3: Typecheck** → PASS. Commit: `feat(core): React Query hooks (mold + Eve drift: reaction, unseen count, reconciliation)`

---

### Task 7: core — inbox (service + hooks)

**Files:**

- Create: `packages/core/src/inbox-service.ts`, `packages/core/src/inbox-hooks.ts`
- Source: Eve `services/notification-center.ts`, `hooks/useNotificationCenter.ts`.

**Interfaces:**

- Consumes: config (Task 2), identity (Task 4).
- Produces:

```ts
export type InboxItem = {
  id: string;
  kind: "like" | "comment" | "reaction" | "official_post" | (string & {});
  createdAt: string; actorName: string | null; postId: string | null;
  payload: Record<string, unknown>;
};
export async function fetchInbox(cfg): Promise<{ items: InboxItem[]; seenAt: string | null }>; // RPC list_notifications + notification_seen
export async function markInboxSeen(cfg): Promise<void>;
export function unreadCount(items: InboxItem[], seenAt: string | null): number;
export function useNotificationInbox(): UseQueryResult<...>;   // key ["community", "inbox"]
export function useUnreadNotificationCount(): number;           // fails soft to 0 (Eve rule: inbox error never surfaces)
export function useMarkInboxSeen(): UseMutationResult<...>;     // optimistic seenAt update
```

- [ ] **Step 1: Port from Eve** with transformations: kind `prayer` → `reaction`; kind type widened to `(string & {})` for custom service-role kinds (spec §6); Eve's `support_reply` special-casing REMOVED from core (unknown kinds pass through untouched); everything gated on `cfg.modules.inbox` (hooks disabled, `unreadCount` still pure).
- [ ] **Step 2: Unit-test `unreadCount`** in `__tests__/` (pure): items after/before seenAt, null seenAt counts all. Run → PASS after implementation.
- [ ] **Step 3: Typecheck + tests** → PASS. Commit: `feat(core): notification inbox module (Eve backport, custom kinds pass-through)`

---

### Task 8: core — schema check + public index

**Files:**

- Create: `packages/core/src/schema-check.ts`
- Modify: `packages/core/src/index.ts` (final export surface)
- Test: `packages/core/src/__tests__/schema-check.test.ts`

**Interfaces:**

- Produces: `export const REQUIRED_SCHEMA_VERSION = 1;` and `checkSchemaVersion(cfg): Promise<void>` — reads `community_meta.schema_version` (single row), `console.warn`s on mismatch, runs only when `__DEV__ !== false` (guard: `declare const __DEV__: boolean | undefined` with `typeof __DEV__ !== "undefined" && __DEV__`), never throws. Called once from `CommunityProvider` mount effect.
- `index.ts` exports: everything from config, provider, events, models, time, identity, service, inbox, hooks, `REQUIRED_SCHEMA_VERSION`.

- [ ] **Step 1: Test** with a stubbed client (`{ from: () => ({ select: ... }) }` minimal shape): mismatch warns, match silent, query error silent, degraded mode silent. Run → FAIL, implement, PASS.
- [ ] **Step 2: Wire into provider** (`useEffect(() => { void checkSchemaVersion(resolved); }, [resolved])`).
- [ ] **Step 3: Full core suite green:** `npm run test -w @rocapine/community-core && npm run build -w @rocapine/community-core`. Commit: `feat(core): schema version dev check, public API surface`

---

### Task 9: ui — theme system + i18n runtime

**Files:**

- Create: `packages/ui/src/theme.ts`, `packages/ui/src/ThemeProvider.tsx`, `packages/ui/src/i18n.ts`, `packages/ui/src/locales/en.ts`
- Test: `packages/ui/src/__tests__/theme.test.ts`, `__tests__/i18n.test.ts`
- Source: mold `sdk/client/components/community/theme.tsx` (the seam listing every token the components already consume — the CommunityTheme shape below must be reconciled against it), Eve `i18n/en/community.json` (key inventory), Nightward key-based usage.

**Interfaces:**

- Produces:

```ts
// theme.ts
export type CommunityTheme = {
  colors: {
    background: string;
    surface: string;
    surfaceMuted: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    textInverse: string;
    accent: string;
    accentSoft: string;
    danger: string;
    success: string;
    like: string;
    official: string;
    pinned: string;
  };
  fonts: { regular: string; medium: string; bold: string };
  radius: { sm: number; md: number; lg: number; pill: number };
  spacing: (n: number) => number; // default n * 4
};
export const defaultTheme: CommunityTheme; // neutral palette, undefined-font-safe (system font)
export function mergeTheme(partial: DeepPartial<CommunityTheme>): CommunityTheme;

// ThemeProvider.tsx
export function CommunityUIProvider(props: {
  theme?: DeepPartial<CommunityTheme>;
  translations?: { locale?: string; overrides?: Record<string, string> };
  children: ReactNode;
}): JSX.Element;
export function useCommunityTheme(): CommunityTheme;
export function useT(): (key: string, params?: Record<string, string | number>) => string;

// i18n.ts
export function makeT(locale: string, overrides?: Record<string, string>): TFn;
// resolution: overrides → catalog[locale] → catalog.en → the key itself
// params: "{count} votes" interpolation; plural via explicit keys `<key>.one` / `<key>.other`
```

- [ ] **Step 1: Tests first** — `i18n.test.ts`: en lookup, override wins, unknown locale falls back to en, missing key returns key, interpolation, plural picks `.one` at 1 / `.other` at 0 and 2. `theme.test.ts`: `mergeTheme({ colors: { accent: "#f00" } })` keeps other defaults. Run → FAIL.
- [ ] **Step 2: Implement** theme.ts, i18n.ts. Build `locales/en.ts` by porting Eve's `i18n/en/community.json` flattened (`feed.empty`, `composer.placeholder`, `poll.votes.one`, `topics.general`, …) with degendered copy: every "sister" phrasing rewritten neutrally (e.g. `inbox.aSister` → key `inbox.someone`, value "Someone"), "Eve's News" → generic `topics.news` "News". Topic label resolution rule: `t("topics." + id)` — apps supply overrides for custom topics.
- [ ] **Step 3: Implement providers** (two contexts, memoized `makeT`).
- [ ] **Step 4: Tests pass.** Commit: `feat(ui): theme tokens + framework-free i18n with en catalog`

---

### Task 10: ui — Sheet + small components (CommunityPost, PollBlock, NoticeCard)

**Files:**

- Create: `packages/ui/src/Sheet.tsx`, `packages/ui/src/components/CommunityPost.tsx`, `components/PollBlock.tsx`, `components/NoticeCard.tsx`
- Source: mold `sdk/client/components/community/ui.tsx` (the mold's sheet/primitives seam — base for Sheet.tsx), `CommunityPost.tsx`, `PollBlock.tsx`, `NoticeCard.tsx`; Eve's `CommunityPost.tsx` for the reaction footer.

**Interfaces:**

- Consumes: core hooks/models, `useCommunityTheme`, `useT`.
- Produces:

```ts
export function CommunitySheet(props: {
  visible: boolean;
  onClose(): void;
  children: ReactNode;
  snapTo?: "half" | "full";
}): JSX.Element; // self-contained modal sheet (RN Modal + reanimated slide), no external sheet machinery
export type PostSlots = {
  renderPostFooter?: (post: FeedPost, defaults: ReactNode) => ReactNode;
  renderReactionButton?: (post: FeedPost, defaultButton: ReactNode) => ReactNode;
};
export function CommunityPost(
  props: {
    post: FeedPost;
    onOpenThread(postId: string): void;
    onOpenProfile(userId: string): void;
    onMenu(post: FeedPost): void;
  } & PostSlots,
): JSX.Element;
export function PollBlock(props: { post: FeedPost }): JSX.Element; // votes via useVotePoll
export function NoticeCard(props: { kind: "rejected" | "network"; onDismiss(): void }): JSX.Element;
```

- [ ] **Step 1: Port `ui.tsx` → `Sheet.tsx`**: replace `EveSheet`-style dependency with a self-contained implementation (RN `Modal`, reanimated `withTiming` slide-up, backdrop pressable). All styling from `useCommunityTheme()`.
- [ ] **Step 2: Port the three components**: replace mold theme-seam imports with `useCommunityTheme()`, hardcoded strings with `useT()` keys, navigation with the callback props above; reaction button renders only when `cfg.modules.reaction` (from `useCommunityConfig()`), wrapped by `renderReactionButton` slot; footer wrapped by `renderPostFooter`. Haptics via `expo-haptics` directly (mold's `lib/haptics.ts` seam dissolves).
- [ ] **Step 3: Verify** `npm run typecheck -w @rocapine/community-ui` → PASS. Commit: `feat(ui): self-contained sheet, post card with slots, poll block, notice card`

---

### Task 11: ui — ComposerCard, RulesSheet, ReportSheet

**Files:**

- Create: `packages/ui/src/components/ComposerCard.tsx`, `components/RulesSheet.tsx`, `components/ReportSheet.tsx`
- Source: Eve `components/app/community/ComposerCard.tsx` (newer than mold — mold has composer inline), mold `CommunityRulesSheet.tsx`, `ReportSheet.tsx`.

**Interfaces:**

- Consumes: `useCreatePost`, `useReport`, `useCommunityConfig` (topics via `composeTopics()`, `modules.polls`), theme, `useT`, `CommunitySheet` (Task 10), limits (Task 3).
- Produces:

```ts
export function ComposerCard(props: {
  defaultTopic?: string;
  renderComposerExtra?: ReactNode;
}): JSX.Element;
// topic chips from cfg.composeTopics() labeled t("topics."+id); poll editor only if cfg.modules.polls;
// locked behind rules acceptance (cfg.host.rulesAcceptance.get()) — tapping when locked opens RulesSheet
export function RulesSheet(props: {
  visible: boolean;
  onAccepted(): void;
  onClose(): void;
}): JSX.Element;
// 4 rules from i18n keys rules.1..4; accept → cfg.host.rulesAcceptance.set() + emitEvent(rulesAccepted)
export function ReportSheet(props: {
  visible: boolean;
  target: { kind: "post" | "comment"; id: string } | null;
  onClose(): void;
}): JSX.Element;
// 5 reasons from i18n keys report.reason.{spam,harassment,hate,sexual,other} + details field → useReport
```

- [ ] **Step 1: Port** with the standard transformations (theme hook, `useT`, config-driven topics/modules, no store — rules state via adapter + local `useState` refresh).
- [ ] **Step 2: Typecheck** → PASS. Commit: `feat(ui): composer (Eve backport), rules gate, report sheet`

---

### Task 12: ui — CommunityFeedScreen + ThreadSheet

**Files:**

- Create: `packages/ui/src/screens/CommunityFeedScreen.tsx`, `screens/ThreadSheet.tsx`
- Source: mold `sdk/client/app/community.tsx` (route → component conversion), `components/community/CommunityThread.tsx`; Eve's `app/(app)/(tabs)/community.tsx` for search + "N new posts" pill + reaction wiring.

**Interfaces:**

- Consumes: everything above.
- Produces:

```ts
export function CommunityFeedScreen(props: {
  onOpenProfile(userId: string): void;
  onOpenInbox?: () => void;
  header?: ReactNode; // app renders its own top bar
  slots?: PostSlots; // forwarded to every CommunityPost
}): JSX.Element;
// contains: topic filter chips, search, new-posts pill, ComposerCard, FlatList feed,
// ThreadSheet + ReportSheet + RulesSheet orchestration, block/delete menus, emitEvent(opened) on mount
export function ThreadSheet(props: {
  postId: string | null;
  onClose(): void;
  onOpenProfile(userId: string): void;
  slots?: PostSlots;
}): JSX.Element;
```

- [ ] **Step 1: Port the mold screen as a component**: strip expo-router imports (`useFocusEffect` → `useEffect` on mount for the `opened` event; router pushes → the two callbacks); merge Eve's search + pill; all strings via `useT`.
- [ ] **Step 2: Port ThreadSheet** on `CommunitySheet` (comment composer inside, `useThread`, `useCreateComment`).
- [ ] **Step 3: Typecheck** → PASS. Commit: `feat(ui): feed screen and thread sheet as router-free components`

---

### Task 13: ui — ProfileScreen, ProfileEditSheet, NotificationInboxScreen

**Files:**

- Create: `packages/ui/src/screens/ProfileScreen.tsx`, `screens/ProfileEditSheet.tsx`, `screens/NotificationInboxScreen.tsx`
- Source: mold `app/user/[id].tsx`, `ProfileEditSheet.tsx`, mold `hooks/useAvatarPicker.ts`; Eve `app/(app)/notifications.tsx`.

**Interfaces:**

- Consumes: core profile/inbox hooks, theme, i18n, `CommunitySheet`.
- Produces:

```ts
export function ProfileScreen(props: {
  userId: string;
  onOpenThread(postId: string): void;
  onBack?: () => void;
  slots?: PostSlots;
}): JSX.Element;
export function ProfileEditSheet(props: { visible: boolean; onClose(): void }): JSX.Element; // handle/bio/avatar via useUpdateProfile + uploadAvatar; avatar picking via expo-image-picker (add to ui peer+dev deps in this task)
export function NotificationInboxScreen(props: {
  onOpenPost(postId: string): void;
  renderInboxRow?: (item: InboxItem, defaults: ReactNode | null) => ReactNode; // defaults null for unknown kinds
}): JSX.Element; // marks seen on mount (optimistic), emitEvent(inboxOpened, { unread_count })
```

- [ ] **Step 1: Port** with standard transformations; inbox rows for the 4 standard kinds, unknown kinds render `renderInboxRow(item, null)` or nothing.
- [ ] **Step 2: Typecheck** → PASS. Commit: `feat(ui): profile screens and notification inbox with custom-kind slot`

---

### Task 14: ui — remaining locale catalogs + package surface

**Files:**

- Create: `packages/ui/src/locales/{es-ES,es-419,it,pl,pt-PT,pt-BR}.ts`, finalize `packages/ui/src/index.ts`
- Source: Eve `i18n/{es-ES,es-419,it,pl,pt-PT,pt-BR}/community.json`.

- [ ] **Step 1: Port the 6 catalogs** flattened to the Task 9 key scheme, degendered the same way as en (translate the neutral replacements — e.g. es "Alguien", it "Qualcuno"; the executor rewrites each gendered value in-language, this is copy translation work, not machine key mapping).
- [ ] **Step 2: Consistency test** in `i18n.test.ts`: every catalog has exactly the same key set as en (iterate, assert equal sorted keys). Run → PASS (fix omissions).
- [ ] **Step 3: `index.ts`** exports all components/screens/theme/i18n APIs; `npm run build -w @rocapine/community-ui` → PASS. Commit: `feat(ui): 7 locale catalogs, public surface`

---

### Task 15: backend — migrations reorg (core/push/polls) with placeholders + community_meta

**Files:**

- Create: `supabase/migrations/core/{001_tables,002_rls,003_moderation,004_dashboard,005_avatars,006_meta}.sql`, `supabase/migrations/push/{001_push,002_triggers}.sql`, `supabase/migrations/polls/001_polls.sql`
- Source: mold `sdk/migrations/20260729000001..7`.

**Interfaces:**

- Produces: module-organized SQL, each file header comment `-- community-sdk <module>/<file> (schema v1)`; `community_meta` table; the guard pattern used by every URL-bearing file.

- [ ] **Step 1: Copy mold migrations** into the module layout (1→core/001, 2→core/002, 3→core/003, 4→core/004, 7→core/005, 5→push/001+002 split at the trigger boundary, 6→polls/001).
- [ ] **Step 2: Placeholders + guard.** In every statement embedding a project URL or anon key (cron/webhook `net.http_post` calls in core/003 and push/002), use `__SUPABASE_PROJECT_URL__` / `__SUPABASE_ANON_KEY__` and prepend once per file:

```sql
do $$ begin
  if '__SUPABASE_PROJECT_URL__' like '\_\_SUPABASE%' escape '\' then
    raise exception 'community-sdk: placeholders not substituted. Run: npx @rocapine/community init';
  end if;
end $$;
```

(After CLI substitution the literal becomes the real URL and the check is false; unsubstituted, it raises. Verify the mold files — if they already carry placeholders from the Nightward runbook work, only add the guard.)

- [ ] **Step 3: `core/006_meta.sql`:**

```sql
create table if not exists public.community_meta (
  id boolean primary key default true check (id),
  schema_version int not null
);
insert into public.community_meta (schema_version) values (1)
  on conflict (id) do update set schema_version = excluded.schema_version;
alter table public.community_meta enable row level security;
create policy "community_meta readable" on public.community_meta for select using (true);
```

- [ ] **Step 4: Smoke-verify** on a scratch local stack: `supabase init` in a temp dir, copy core files (placeholders substituted with dummy `https://example.supabase.co` / dummy key via `sed`), `supabase db start && supabase db push` → applies cleanly. Commit: `feat(backend): module-organized migrations with placeholder guards + community_meta`

---

### Task 16: backend — reaction + inbox migration modules

**Files:**

- Create: `supabase/migrations/reaction/001_reactions.sql`, `supabase/migrations/inbox/001_inbox.sql`
- Source: Eve `supabase/migrations/20260812090000_post_prayers.sql`, `20260813090000_notifications_inbox.sql`, `20260813160000_official_posts_inbox.sql`.

**Interfaces:**

- Produces: `post_reactions` table (private, non-retractable, RLS insert-own/select-own), `post_reaction_summary(post_ids uuid[])` security-definer RPC (per post: `reaction_count int`, `last_reactor_name text`, `has_reacted bool`), reaction inbox trigger; `notifications`/`notification_seen` tables, triggers (like insert/retract, comment on pending→visible, reaction), `list_notifications()` RPC (stored rows ∪ all visible posts by `is_official` profiles, 90-day window), 90-day pg_cron purge. These names are what core Tasks 5/7 call.

- [ ] **Step 1: Port Eve's prayers migration** with renames `post_prayers`→`post_reactions`, `post_prayer_summary`→`post_reaction_summary`, `notify_prayers`→`notify_reactions` (push_tokens pref column), `prayer`→`reaction` in trigger/kind names. Keep semantics: rows private, no delete policy, summary returns last reactor display name.
- [ ] **Step 2: Port Eve's two inbox migrations** merged into one file, with kind `prayer`→`reaction` and the kind column left as unconstrained `text` (custom service-role kinds, spec §6). Cross-module note in header: inbox's reaction trigger is created `if exists post_reactions` guarded (`do $$ if to_regclass('public.post_reactions') is not null then ... end $$`) so inbox installs without the reaction module.
- [ ] **Step 3: Smoke-verify** both files on the Task 15 scratch stack (after core). Commit: `feat(backend): reaction module (post_prayers generalized) + inbox module`

---

### Task 17: backend — Edge Functions port

**Files:**

- Create: `supabase/functions/_shared/{client,config,moderation,push,slack}.ts`, `supabase/functions/{moderate-one,daily-moderation,update-profile,notify-comment,notify-like,notify-reaction,report-to-slack,broadcast-post}/index.ts`
- Source: mold `sdk/functions/*` (baseline, already factorized), Eve `supabase/functions/notify-prayer/index.ts` (→ notify-reaction).

**Interfaces:**

- Produces: functions configured entirely by env: `COMMUNITY_APP_NAME`, `COMMUNITY_FALLBACK_NAME`, `OPENAI_API_KEY` (required by moderation fns — clear startup error if missing), `SLACK_WEBHOOK_URL` (optional), `MODERATION_SCORE_THRESHOLD` (default `0.5`), `MODERATION_EXCLUDED_CATEGORIES` (comma list, default empty), `COMMUNITY_REACTION_PUSH_TEXT` (optional template override, `{name}` param).

- [ ] **Step 1: Copy mold functions.** In `_shared/`, add `slack.ts`:

```ts
export async function postToSlack(payload: unknown): Promise<void> {
  const url = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!url) {
    console.log("community-sdk: SLACK_WEBHOOK_URL not set, skipping Slack notification");
    return;
  }
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
```

Route `report-to-slack` and `daily-moderation` summaries through it (they currently assume the webhook exists).

- [ ] **Step 2: Moderation settings.** In `_shared/moderation.ts`, read `MODERATION_SCORE_THRESHOLD` and `MODERATION_EXCLUDED_CATEGORIES` from env (Eve's hardcoded `sexual*` exclusion becomes documentation: "Eve sets MODERATION_EXCLUDED_CATEGORIES=sexual"). Keep fail-closed verdicts.
- [ ] **Step 3: Port notify-reaction** from Eve's notify-prayer with renames (table/pref/kind per Task 16) and push copy from profile `locale` + `COMMUNITY_REACTION_PUSH_TEXT` fallback "{name} is thinking of you" — neutral default, apps override the secret.
- [ ] **Step 4: Verify** `deno check supabase/functions/**/index.ts` → PASS. Commit: `feat(backend): edge functions with optional Slack, env-driven moderation, notify-reaction`

---

### Task 18: cli — manifest, substitution, `init`

**Files:**

- Create: `packages/cli/src/{index.ts,manifest.ts,substitute.ts}`, `packages/cli/src/commands/init.ts`
- Test: `packages/cli/src/__tests__/{manifest.test.ts,substitute.test.ts,init.test.ts}`

**Interfaces:**

- Produces:

```ts
// manifest.ts — file community-sdk.json at app repo root
export type Manifest = {
  schemaVersion: number;
  sdkVersion: string;
  modules: string[];
  installedFiles: string[];
};
export function readManifest(dir: string): Manifest | null;
export function writeManifest(dir: string, m: Manifest): void;
// substitute.ts
export function substitutePlaceholders(
  sql: string,
  values: { projectUrl: string; anonKey: string },
): string; // throws if a __SUPABASE placeholder remains after substitution
// commands/init.ts — `community init [--modules core,push,polls,inbox,reaction] [--project-url ... --anon-key ...] [--dir supabase]`
// copies module migrations (renamed <today's YYYYMMDDHHMMSS+n>_community_<module>_<name>.sql, ordered core→push→polls→inbox→reaction)
// and all functions into <dir>/, substitutes placeholders, writes manifest, prints next steps (db push, secrets, functions deploy)
```

Migration templates ship inside the package: `files` includes `templates/` — the build copies `supabase/` from the repo root into `packages/cli/templates/` (script `"prebuild": "node scripts/copy-templates.mjs"`).

- [ ] **Step 1: Tests first** (vitest, temp dirs via `fs.mkdtempSync`): substitution replaces both placeholders everywhere and throws on leftovers; manifest round-trips; init copies core-only when `--modules core`, filenames timestamp-prefixed and ordered, placeholders substituted in output, manifest lists files, running init twice fails with "already initialized (found community-sdk.json), use upgrade". Run → FAIL.
- [ ] **Step 2: Implement** (commander program; prompts via `readline` when flags missing; `--project-url`/`--anon-key` read from `<dir>/config.toml` `project_id` when derivable, else prompted). Make tests PASS.
- [ ] **Step 3: Wire `bin`,** `npm run build -w @rocapine/community`, run `node packages/cli/lib/index.js init --help` → prints usage. Commit: `feat(cli): init with module selection, placeholder substitution, manifest`

---

### Task 19: cli — `upgrade` and `adopt`

**Files:**

- Create: `packages/cli/src/commands/upgrade.ts`, `commands/adopt.ts`
- Modify: `packages/cli/src/index.ts` (register commands)
- Test: `packages/cli/src/__tests__/upgrade.test.ts`

**Interfaces:**

- Consumes: manifest + substitute + template layout from Task 18.
- Produces: `community upgrade` — diffs manifest (`schemaVersion`, `modules`, `installedFiles`) against the installed package's templates; copies only template files not in `installedFiles` (new migrations, changed functions are overwritten with a warning listing them); updates manifest. `community adopt --schema-version N --modules core,push,...` — writes the manifest only (for Eve/Nightward whose schema is already live), copies nothing, prints the compat table pointer.

- [ ] **Step 1: Tests:** upgrade on an up-to-date manifest is a no-op ("already up to date"); after adding a fake new template migration, upgrade copies exactly it; adopt writes manifest without touching `<dir>/migrations`. Run → FAIL, implement, PASS.
- [ ] **Step 2: Commit** `feat(cli): upgrade and adopt commands`

---

### Task 20: example Expo app

**Files:**

- Create: `examples/expo-app/` (via `npx create-expo-app@latest` minimal template), `App.tsx`, `community-config.ts`, `.env.example`

**Interfaces:**

- Consumes: both packages via `workspace:*`.

- [ ] **Step 1: Scaffold** Expo app (SDK 55, no router — single screen), add workspace deps + peers (reanimated, expo-image, expo-haptics, expo-image-picker, phosphor).
- [ ] **Step 2: Wire providers:**

```tsx
const config: CommunityConfig = {
  supabase:
    url && key
      ? createClient(url, key, { auth: { storage: AsyncStorage, persistSession: true } })
      : null,
  appName: "Community SDK Demo",
  anonymousAuthorFallback: "Someone",
  topics: [{ id: "general" }, { id: "question" }, { id: "news", officialOnly: true }],
  modules: { polls: true, push: false, inbox: true, reaction: { key: "cheer" } },
  host: { onEvent: (n, p) => console.log("[event]", n, p) },
};
// QueryClientProvider > CommunityProvider > CommunityUIProvider(theme minimal accent override)
// > CommunityFeedScreen with onOpenProfile/onOpenInbox switching a useState "route"
// + ProfileScreen / NotificationInboxScreen behind that state
```

- [ ] **Step 3: Verify degraded mode:** `npx expo start` without env vars — app renders feed empty state, exactly one console warning, zero crashes. This is the acceptance test for the Global Constraint.
- [ ] **Step 4: Verify live (manual, with Argent):** point `.env` at a scratch Supabase project initialized via `node ../../packages/cli/lib/index.js init` + `supabase db push` + anonymous sign-ins enabled; post, comment, like, vote, react, check inbox. Commit: `feat(examples): expo demo app (degraded + live modes)`

---

### Task 21: docs + release prep

**Files:**

- Create: `README.md` (root), `packages/{core,ui,cli}/README.md`, `docs/integration-skill.md`, `docs/backend-runbook.md`, `docs/compat.md`, `.changeset/<generated>.md`
- Source: mold `SKILL.md` (phased agent guide), Nightward `docs/community-setup.md` (runbook).

- [ ] **Step 1: Write docs.** Root README: what/why, 5-minute quickstart (install, CLI init, provider wiring), module matrix, link to dashboard note ("a hosted moderation dashboard is used internally at Rocapine; the schema ships a `community_dashboard` migration so any admin tool can plug in — moderate via SQL/Studio otherwise"). `integration-skill.md`: port the mold's SKILL.md phases updated for npm install + CLI. `backend-runbook.md`: port Nightward's runbook (secrets table incl. the Task 17 env list, anonymous sign-ins, cron verification). `compat.md`: table `SDK version ↔ schema version` starting `0.1.x ↔ 1`.
- [ ] **Step 2: Changeset + versions:** `npx changeset` (minor, all three packages, summary "initial public release"), `npx changeset version` → `0.1.0` everywhere.
- [ ] **Step 3: Release checklist** at end of root README (maintainers section): confirm repo/package names with Martin (§9), npm org `@rocapine` exists + 2FA + `NPM_TOKEN` secret, LICENSE confirmed MIT, create GitHub repo and push, then `npm run release` (dry-run first: `npm publish --dry-run --workspaces`). Do NOT publish in this task — publishing is gated on the §9 confirmations (a human step).
- [ ] **Step 4: Final full check:** `npm run typecheck && npm test && npm run build && npm publish --dry-run --workspaces` → all green. Commit: `docs: readmes, integration skill, backend runbook, compat table + v0.1.0 changeset`

---

## Self-review notes (done at write time)

- Spec coverage: §2→T1, §3.1→T2-8, §4→T9-14, §5→T15+18-19, §6→T16-17 (+T5-7 client side), §7 step 2→T20-21, §8→T1 (changesets/CI), T8 (schema check), T21 (compat/docs). §7 steps 3-5 intentionally out of scope (separate plans). §9 items surface in T21's release checklist.
- Deliberate scope calls an executor must not "fix": no supabase-mock test suite for service/hooks (spec §8: example app is the QA bench), no RNTL component tests in v1, publishing gated on human confirmation.
- Verify-at-port flags (exploration was summary-level): exact limit values (T3), whether mold migrations already have placeholders (T15), whether the mold hooks already contain Eve's moderation reconciliation (T6), CommunityTheme token list vs mold `theme.tsx` (T9 — reconcile, keep semantic superset).
