# Online Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show who is in the app right now: a green dot on the avatars of online members who allow it, a live online count in the community header, and a per-member switch to hide one's own status. The work lands in the Community SDK first, then in Unchaind.

**Architecture:** The client sends a heartbeat (`touch_presence()`) every 60 s while the app is in the foreground, plus once when it goes to the background. Each heartbeat stamps one overwritten `last_active_at` per member, in a new `presence` migration module. "Online" means `last_active_at > now() - grace` and is evaluated server-side. Clients call security-definer RPCs that return a count or a list of ids, never timestamps. The UI asks for the online state of the avatars on screen through one batched RPC per screen and refreshes every 60 s. The dot is drawn by the SDK's `Avatar` wrapper around whatever avatar the app renders.

**Tech Stack:** Supabase Postgres (SQL migrations, RLS, security-definer RPCs), TypeScript, TanStack Query v5, React Native and Reanimated (already used by `ImageViewer`), Vitest, and the `@rocapine/community` CLI.

**Spec:** `docs/superpowers/specs/2026-11-12-online-presence-design.md`

## Global Constraints

- **Precondition:** [Rocapine/community-sdk#82](https://github.com/Rocapine/community-sdk/pull/82) (`feat/mutual-blocks`) must be merged first, because it adds `public.blocked_member_ids()` in `core/016_mutual_blocks.sql` and this plan relies on it. Before Task 1, run `git rebase origin/main`. If #82 is still open, rebase onto `origin/feat/mutual-blocks` instead and rebase again once it merges.
- The rule behind every choice: **show presence, never absence.** No grey dot, no "Inactive", no last-seen text, nowhere.
- Online = foreground on any screen, plus a grace period. The grace defaults to **5 minutes** and is configurable.
- Module config, with these exact defaults:
  `modules.presence?: { graceMinutes?: number /* 5 */; minCount?: number /* 0 */; collapseAfterMs?: number | false /* 3000 */ } | false`.
- No timestamp reaches a client through any API. RLS and column grants make `last_active_at` unreadable to `anon` and `authenticated`.
- Hidden members are counted in the total, anonymously. Banned members are neither counted nor shown. Admins are counted and shown like anyone else.
- Blocks hide the dot in both directions, using `blocked_member_ids()`. Blocked members still count in the total.
- No reciprocity: hiding your own status does not hide anyone else's from you.
- Presence never creates an identity. With no Supabase session, there is no heartbeat and no anonymous sign-in.
- One analytics event, `community_presence_visibility_changed { visible }`. Nothing is tracked on the header pill.
- Copy goes in all 13 SDK locales (`packages/ui/src/locales/*`, `fr-vous` included), with plural keys following each locale's existing `feed.newPosts.*` categories.
- The green is `theme.colors.success` (Unchaind maps it to `#22C55E`).
- Under Reduce Motion (Reanimated `useReducedMotion()`): no pulses, and the collapse switches without animation.
- Repo rule (`CLAUDE.md`): in the same PR, update the SDK coverage table and the bricks in `docs/dashboard-roadmap.md`, plus a changeset and the module docs.
- Commits use the repo style (`feat: …`, `docs: …`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Open Expo dev clients with `__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1`. Every PR that changes something visible embeds a simulator recording.
- Unchaind production Supabase migrations run only after Guillaume says yes in chat.

## Review Focus

1. **Module off, or a backend without the migration.** Every presence query is disabled, no RPC runs, and nothing renders: no dot, no pill, no switch. → tests in Task 3 (`enabled: false`) and Task 5 (`resolveHeaderZones` drops `"online"`).
2. **iOS spamming `inactive`/`active` events** (Control Center, notification shade). The heartbeat must never stack two intervals, and must send at most one beat per real transition. → `startPresenceHeartbeat` test in Task 2.
3. **No session yet** (Unchaind before onboarding and the paywall). `touchPresence` must neither call `signInAnonymously` nor run an RPC. → Task 2 test.
4. **A busy screen:** the same author on many posts, or more than 200 distinct avatars. The batcher must deduplicate ids and split them into chunks of 200, and an RPC failure must resolve to `false` (no dot) instead of an error state. → Task 2 batcher tests.
5. **A failed visibility write.** The switch must go back to its previous position and no analytics event may be sent. → Task 3 mutation test. `BadgeToggle` already reverts on rejection.

---

### Task 1: Backend: `presence` migration module, SQL test, CLI

**Files:**

- Create: `supabase/migrations/presence/001_presence.sql`
- Create: `supabase-tests/presence.sql`
- Modify: `packages/cli/src/install-shared.ts` (`MODULE_ORDER`)
- Modify: `packages/cli/src/index.ts:41,113` (module list in help text)
- Test: `packages/cli/src/__tests__/init.test.ts`

**Interfaces:**

- Produces (SQL, all `security definer set search_path = public`; `execute` revoked from `public, anon` and granted to `authenticated`):
  - `public.touch_presence() returns void`: upserts `(auth.uid(), now())`.
  - `public.set_presence_visible(p_visible boolean) returns void`: upserts `visible`.
  - `public.online_member_count(p_grace_minutes int) returns int`
  - `public.online_member_ids(p_ids uuid[], p_grace_minutes int) returns uuid[]`
  - Table `public.member_presence(user_id uuid primary key references public.profiles(id) on delete cascade, last_active_at timestamptz not null default now(), visible boolean not null default true)`, with an index on `last_active_at`. RLS is enabled with one select policy, `user_id = auth.uid()`. The only grant is `grant select (user_id, visible) on public.member_presence to authenticated`. `user_id` is included because the owner filters on it (`eq("user_id", uid)`), and Postgres checks column privileges on WHERE columns too.
- Grace in both read RPCs: `make_interval(mins => least(greatest(p_grace_minutes, 1), 60))`.
- Online filter: `last_active_at > now() - grace` and the profile is `not is_banned`. `online_member_ids` additionally requires `visible`, requires the id to be in `p_ids` (only the first 200 are used), and requires `not (id = any ((select public.blocked_member_ids())::uuid[]))`.

- [ ] **Step 1: Write the failing CLI test** in `init.test.ts`, next to the badges case:

```ts
it("installs presence after core", async () => {
  const result = await runInit({ modules: "core,presence" }); // same helper the badges case uses
  expect(result.manifest.modules).toEqual(["core", "presence"]);
  expect(result.files.some((f) => f.includes("_community_presence_presence"))).toBe(true);
});
```

- [ ] **Step 2: Run** `npm test -w @rocapine/community -- init` and expect a FAIL with an unknown module.
- [ ] **Step 3: Add `"presence"` to `MODULE_ORDER` right after `"badges"`** and to both help strings. Then write `001_presence.sql` with the header comment style of `badges/001_badges.sql`, fully idempotent (`if not exists`, `create or replace`, `drop policy if exists`).
- [ ] **Step 4: Run** `npm test -w @rocapine/community` and expect a PASS (the `upgrade` tests included).
- [ ] **Step 5: Write `supabase-tests/presence.sql`** in the pattern of `supabase-tests/blocks.sql`. It runs as a `do $$ … $$` block, takes 5 member profiles `v, a, b, c, e`, and always rolls back by raising `PRESENCE_TESTS_PASSED`. Setup, as `postgres`: insert presence rows for `v, a, b, c, e` with `now()`; `b.visible = false`; `c` banned; `e` blocked by `v`; a 6th profile `s` stamped `now() - interval '6 minutes'`. Assertions, made as `v` (`set local role authenticated` + jwt claims):

```sql
assert public.online_member_count(5) = 4;                     -- v, a, b, e (c banned, s stale)
assert public.online_member_ids(array[v,a,b,c,e,s], 5) @> array[v,a]
   and cardinality(public.online_member_ids(array[v,a,b,c,e,s], 5)) = 2;  -- b hidden, e blocked
assert public.online_member_count(10) = 5;                    -- s back inside a 10-minute grace
assert public.online_member_count(0) = public.online_member_count(1); -- grace clamped to >= 1
-- also as e (the blocked one): v is not in e's list
begin perform last_active_at from public.member_presence limit 1;
  raise exception 'timestamps readable'; exception when insufficient_privilege then null; end;
assert (select count(*) from public.member_presence where user_id = a) = 0; -- others' rows invisible
perform public.set_presence_visible(false);
assert (select visible from public.member_presence where user_id = v) = false;
```

- [ ] **Step 6: Apply to the SDK scratch project** (`cozfrhmbjrvotpwjnqmu`, the one PR #82 used) and run the test:
      `npx supabase db query --remote=cozfrhmbjrvotpwjnqmu --yes -f supabase/migrations/presence/001_presence.sql`, then the same command with `-f supabase-tests/presence.sql`.
      Expected: an error whose message is exactly `PRESENCE_TESTS_PASSED`. If the classifier refuses to write to scratch, stop and ask Guillaume to run these two commands.
- [ ] **Step 7: Commit** `feat: presence migration module (member_presence + online RPCs)`.

### Task 2: Core: presence settings, service, heartbeat and batcher

**Files:**

- Modify: `packages/core/src/config.ts` (the `presence` entry in `CommunityModules`, plus `presenceSettings`)
- Create: `packages/core/src/presence.ts`
- Test: `packages/core/src/__tests__/presence.test.ts`, and `config.test.ts` for `presenceSettings`

**Interfaces:**

- Consumes: the Task 1 RPC names and params (`p_grace_minutes`, `p_ids`, `p_visible`).
- Produces:
  - `config.ts`: `export type PresenceSettings = { graceMinutes: number; minCount: number; collapseAfterMs: number | false }` and `export function presenceSettings(cfg: ResolvedCommunityConfig): PresenceSettings | null`. It returns null when the module is absent or false, and otherwise the defaults `5 / 0 / 3000`, overridden by any field the app sets.
  - `presence.ts`:
    - `export const PRESENCE_HEARTBEAT_MS = 60_000`
    - `export type AppStateLike = { currentState: string; addEventListener(type: "change", listener: (state: string) => void): { remove(): void } }`. This is React Native's `AppState` shape; core does not import `react-native`.
    - `export function touchPresence(cfg): Promise<void>`. It never rejects. It is a no-op when the module is off, when there is no client, or when `client.auth.getSession()` has no session. Otherwise it calls `rpc("touch_presence")`.
    - `export function startPresenceHeartbeat(cfg, appState: AppStateLike, intervalMs = PRESENCE_HEARTBEAT_MS): () => void`. It returns a stop function, and a no-op stop when the module is off.
    - `export async function fetchOnlineCount(cfg): Promise<number>`
    - `export async function fetchOnlineIds(cfg, ids: string[]): Promise<string[]>`
    - `export function createOnlineBatcher(fetch: (ids: string[]) => Promise<string[]>, windowMs = 30, chunkSize = 200): (id: string) => Promise<boolean>`
    - `export async function fetchMyPresenceVisible(cfg): Promise<boolean>`. It selects `visible` from `member_presence` with `eq("user_id", uid)` and `.maybeSingle()`, so a missing row reads as `true`. It uses `ensureIdentity` for the uid, the way `setBadgeVisibility` does.
    - `export async function setPresenceVisible(cfg, visible: boolean): Promise<void>`. It throws on error.

Heartbeat semantics: treat `"active"` as foreground and every other state as background.

- On start while active: beat now and start the interval.
- On a background-to-active transition: beat, and start the interval if none is running.
- On an active-to-background transition: clear the interval, then beat once.
- When the state repeats, do nothing.
- Stop clears the interval and removes the listener.

- [ ] **Step 1: Write the failing tests.** Use a fake client in the style of `identity.test.ts`, extended with `rpc: vi.fn(async () => ({ data, error: null }))`, plus a fake `AppStateLike` whose `emit(state)` calls the listener. Use `vi.useFakeTimers()`.

```ts
it("presenceSettings: null when off, defaults when {}", () => {
  expect(presenceSettings(cfgWith(undefined))).toBeNull();
  expect(presenceSettings(cfgWith({}))).toEqual({
    graceMinutes: 5,
    minCount: 0,
    collapseAfterMs: 3000,
  });
  expect(presenceSettings(cfgWith({ collapseAfterMs: false })).collapseAfterMs).toBe(false);
});
it("touchPresence never signs in when there is no session", async () => {
  const client = fakeClient({ session: null });
  await touchPresence(cfgWith({}, client));
  expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
  expect(client.rpc).not.toHaveBeenCalled();
});
it("heartbeat: one beat per transition, never two intervals", async () => {
  const app = fakeAppState("active");
  const stop = startPresenceHeartbeat(cfg, app, 60_000);
  app.emit("active");
  app.emit("inactive");
  app.emit("active");
  app.emit("active");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(beats()).toBe(4); // start, → inactive, → active, +1 interval tick
  stop();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(beats()).toBe(4);
});
it("batcher dedups within the window and chunks by 200", async () => {
  const fetch = vi.fn(async (ids: string[]) => ids.filter((id) => id.endsWith("0")));
  const load = createOnlineBatcher(fetch, 30, 200);
  const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
  const results = await Promise.all([...ids, "u10", "u10"].map(load));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.map((c) => c[0].length)).toEqual([200, 50]);
  expect(results[10]).toBe(true);
  expect(results[11]).toBe(false);
});
it("batcher resolves false when the fetch fails", async () => {
  const load = createOnlineBatcher(async () => {
    throw new Error("x");
  });
  await expect(load("u1")).resolves.toBe(false);
});
it("fetchOnlineIds passes the grace", async () => {
  await fetchOnlineIds(cfgWith({ graceMinutes: 7 }, client), ["a"]);
  expect(client.rpc).toHaveBeenCalledWith("online_member_ids", {
    p_ids: ["a"],
    p_grace_minutes: 7,
  });
});
```

- [ ] **Step 2: Run** `npm test -w @rocapine/community-core -- presence config` and expect a FAIL with missing exports.
- [ ] **Step 3: Implement** the `config.ts` changes and `presence.ts` against the interfaces above. The doc comment on `modules.presence` follows the style of the other modules and ends with "Absent or false ⇒ nothing changes."
- [ ] **Step 4: Run** the same command and expect a PASS. Then run `npm run typecheck -w @rocapine/community-core`.
- [ ] **Step 5: Commit** `feat(core): presence service, heartbeat and batched online lookup`.

### Task 3: Core: presence hooks, event, exports

**Files:**

- Create: `packages/core/src/presence-hooks.ts`
- Modify: `packages/core/src/events.ts` (`presenceVisibilityChanged: "community_presence_visibility_changed"`)
- Modify: `packages/core/src/index.ts` (export everything public from `presence.ts` and `presence-hooks.ts`, plus `presenceSettings` and `PresenceSettings`)
- Test: `packages/core/src/__tests__/presenceHooks.test.ts`

**Interfaces:**

- Consumes: everything Task 2 produces.
- Produces:

  - `export const PRESENCE_KEY = ["community", "presence"] as const`. It sits under `["community"]`, so profile edits and the existing invalidations refresh it too.
  - `export const PRESENCE_POLL_MS = 60_000`
  - `export function onlineCountQueryOptions(cfg): UseQueryOptions<number>`: key `[...PRESENCE_KEY, "count"]`, `refetchInterval: PRESENCE_POLL_MS`, `staleTime: 30_000`, and `enabled` only when `presenceSettings(cfg)` is set and `cfg.supabase` exists.
  - `export function isOnlineQueryOptions(cfg, userId: string | null): UseQueryOptions<boolean>`: key `[...PRESENCE_KEY, "online", userId]`, with the same interval and staleness. Its `queryFn` calls a batcher memoized per cfg (`WeakMap<ResolvedCommunityConfig, …>` of `createOnlineBatcher(ids => fetchOnlineIds(cfg, ids))`). It is enabled under the same condition and only when `userId !== null`.
  - `export function useOnlineCount(): number | null`: null when disabled or not loaded yet.
  - `export function useIsOnline(userId: string | null): boolean`
  - `export function usePresenceVisible(): boolean | null`: key `[...PRESENCE_KEY, "visible"]`, calling `fetchMyPresenceVisible`, with the same `enabled` condition.
  - `export function presenceVisibilityMutationOptions(cfg, queryClient): UseMutationOptions<void, Error, boolean>`: scope `{ id: "community-presence-visibility" }`. On success it invalidates `PRESENCE_KEY` and emits `presenceVisibilityChanged` with `{ visible }`.
  - `export function useSetPresenceVisible()`

- [ ] **Step 1: Write the failing tests** in the style of `badgeVisibility.test.ts` (mock `../presence` and drive `QueryObserver`/`MutationObserver` on a bare `QueryClient`):

```ts
it("every presence query is disabled when the module is off", () => {
  const off = resolveConfig({ ...base, modules: { ...mods } });
  expect(onlineCountQueryOptions(off).enabled).toBe(false);
  expect(isOnlineQueryOptions(off, "u1").enabled).toBe(false);
});
it("isOnline is disabled without a user id", () => {
  expect(isOnlineQueryOptions(on, null).enabled).toBe(false);
});
it("a failed visibility write rejects and emits nothing", async () => {
  vi.mocked(presence.setPresenceVisible).mockRejectedValue(new Error("x"));
  const onEvent = vi.fn();
  await expect(
    new MutationObserver(qc, presenceVisibilityMutationOptions(cfg(onEvent), qc)).mutate(false),
  ).rejects.toThrow();
  expect(onEvent).not.toHaveBeenCalled();
});
it("a successful write emits community_presence_visibility_changed", async () => {
  vi.mocked(presence.setPresenceVisible).mockResolvedValue();
  await new MutationObserver(qc, presenceVisibilityMutationOptions(cfg(onEvent), qc)).mutate(false);
  expect(onEvent).toHaveBeenCalledWith("community_presence_visibility_changed", { visible: false });
});
```

- [ ] **Step 2: Run** `npm test -w @rocapine/community-core -- presenceHooks events` and expect a FAIL.
- [ ] **Step 3: Implement** `presence-hooks.ts`, the event entry and the exports.
- [ ] **Step 4: Run** `npm test -w @rocapine/community-core && npm run typecheck -w @rocapine/community-core` and expect a PASS.
- [ ] **Step 5: Commit** `feat(core): presence hooks and the visibility event`.

### Task 4: UI: the online dot on avatars, plus all presence copy

**Files:**

- Create: `packages/ui/src/utils/onlineDot.ts`
- Create: `packages/ui/src/components/OnlineDot.tsx`
- Modify: `packages/ui/src/components/Avatar.tsx`
- Modify: `packages/ui/src/screens/ThreadSheet.tsx:745` (pass `ringColor`)
- Modify: `packages/ui/src/locales/*.ts` (all 13)
- Test: `packages/ui/src/__tests__/onlineDot.test.ts`, and `i18n.test.ts`

**Interfaces:**

- Consumes: `useIsOnline` from Task 3.
- Produces:
  - `AvatarRenderProps.online: boolean`, passed to a host's `renderAvatar`.
  - `Avatar` gains an optional `ringColor?: string`, which defaults to `theme.colors.background`.
  - `export function onlineDotMetrics(size: number): { dot: number; ring: number }`: `dot = max(8, round(size * 0.26))`, and `ring = size >= 48 ? 3 : 2`.
  - `OnlineDot({ size, ringColor, pulseOnce }: { size: number; ringColor: string; pulseOnce?: boolean })`. The ringed dot is absolutely positioned with `right: 0, bottom: 0`, its outer diameter is `dot + 2 * ring`, and it uses `theme.colors.success`. It sets `accessible` and `accessibilityLabel={t("a11y.online")}`. With `pulseOnce`, one expanding ring fades out (about 1.1 s, scale 0.7 → 2.6, opacity 0.8 → 0, as in the validated mockup), skipped under Reduce Motion.
  - Locale keys, used by Tasks 4–6. Copy for en and fr is below; translate the other locales in the same register as their `profile.*` keys. `fr-vous` gets the same strings as `fr`.

| key                                                                          | en                                                | fr                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `presence.count.one` / `.other` (+ `.few`/`.many` where the locale has them) | `{count} online`                                  | `{count} en ligne`                                         |
| `a11y.onlineCount.one` / `.other` (+ …)                                      | `{count} person online` / `{count} people online` | `{count} personne en ligne` / `{count} personnes en ligne` |
| `a11y.online`                                                                | `Online`                                          | `En ligne`                                                 |
| `profile.activityStatus`                                                     | `Activity status`                                 | `Statut d'activité`                                        |
| `profile.showOnline`                                                         | `Show when I'm online`                            | `Montrer quand je suis en ligne`                           |

- [ ] **Step 1: Write the failing test** in `onlineDot.test.ts`:

```ts
it.each([
  [24, 8, 2],
  [30, 8, 2],
  [40, 10, 2],
  [72, 19, 3],
])("size %i → dot %i ring %i", (size, dot, ring) => {
  expect(onlineDotMetrics(size)).toEqual({ dot, ring });
});
```

Add to `i18n.test.ts`:

```ts
expect(makeT("en")("presence.count", { count: 12 })).toBe("12 online");
expect(makeT("fr")("a11y.onlineCount", { count: 1 })).toBe("1 personne en ligne");
```

The existing parity tests cover the other locales.

- [ ] **Step 2: Run** `npm test -w @rocapine/community-ui -- onlineDot i18n` and expect a FAIL.
- [ ] **Step 3: Implement.** `Avatar` calls `useIsOnline` only for placements `"post" | "comment" | "profile"` and passes `null` otherwise, so the header, composer, reply bar and edit preview get no dot and no lookup. It wraps the rendered avatar (host or default) in a `View` sized `size × size`, then the `OnlineDot` when online, with `pulseOnce` when `placement === "profile"`. `ThreadSheet` passes its sheet's own background colour as `ringColor` on comment and reply avatars, using the token its container style already uses. Add the locale keys.
- [ ] **Step 4: Run** `npm test -w @rocapine/community-ui && npm run typecheck -w @rocapine/community-ui` and expect a PASS.
- [ ] **Step 5: Commit** `feat(ui): green online dot on member avatars`.

### Task 5: UI: the `"online"` header pill

**Files:**

- Modify: `packages/ui/src/utils/headerZones.ts`
- Create: `packages/ui/src/utils/onlinePill.ts`
- Create: `packages/ui/src/components/OnlinePill.tsx`
- Modify: `packages/ui/src/screens/CommunityFeedScreen.tsx:529-583` (the `resolveHeaderZones` call and a `case "online"`)
- Test: `packages/ui/src/__tests__/headerZones.test.ts`, `packages/ui/src/__tests__/onlinePill.test.ts`

**Interfaces:**

- Consumes: `useOnlineCount`, `presenceSettings` and `useCommunityConfig` from core, plus the `presence.count` and `a11y.onlineCount` keys from Task 4.
- Produces:

  - `FeedHeaderItem` gains `"online"`, with a doc line: "the live online count (presence module)". `DEFAULT_FEED_HEADER` is unchanged.
  - `resolveHeaderZones(config, opts: { inbox: boolean; online: boolean })` drops `"online"` when `!opts.online`. The feed passes `online: !!presenceSettings(cfg)`.
  - `onlinePill.ts`: `export function claimColdStartExpansion(): boolean` returns true on its first call per JS runtime and false after that. `export function resetColdStartExpansion(): void` exists for tests. Cold start therefore means per JS runtime.
  - `OnlinePill()`:
    - It renders nothing while the count is null or `count < minCount`.
    - It is a `Pressable` with no pressed style.
    - Its background is an absolute-fill layer in `theme.colors.success` at `opacity: 0.14`.
    - Its content is the dot (`success`), the number (`fontVariant: ["tabular-nums"]`), and, when expanded, the label `t("presence.count", { count })` with the number removed from the visible label.
    - Its `accessibilityLabel` is always `t("a11y.onlineCount", { count })`.
    - Expansion: on mount, `claimColdStartExpansion()` decides whether it opens expanded. When `collapseAfterMs === false` it stays expanded for good. Otherwise it collapses after `collapseAfterMs`, and a tap expands it again and restarts the timer.
    - The dot pulses on a loop (scale 0.6 → 1.8, opacity 0.7 → 0, 2 s) only while expanded and Reduce Motion is off.
    - The label's width and opacity animate over about 350 ms, or switch instantly under Reduce Motion.

- [ ] **Step 1: Write the failing tests:**

```ts
// headerZones.test.ts
it("drops online when the presence module is off", () => {
  const z = resolveHeaderZones(
    { left: ["online"], right: ["inbox"] },
    { inbox: true, online: false },
  );
  expect(z.left).toEqual([]);
});
it("keeps online when the module is on", () => {
  expect(resolveHeaderZones({ left: ["online"] }, { inbox: false, online: true }).left).toEqual([
    "online",
  ]);
});
// onlinePill.test.ts
it("expands only on the first claim per runtime", () => {
  resetColdStartExpansion();
  expect(claimColdStartExpansion()).toBe(true);
  expect(claimColdStartExpansion()).toBe(false);
});
```

Also update the existing `resolveHeaderZones` call sites in that test file to pass `online`.

- [ ] **Step 2: Run** `npm test -w @rocapine/community-ui -- headerZones onlinePill` and expect a FAIL.
- [ ] **Step 3: Implement** `headerZones.ts`, `onlinePill.ts`, `OnlinePill.tsx` and the feed's `case "online": return <OnlinePill key={index} />`.
- [ ] **Step 4: Run** `npm test -w @rocapine/community-ui && npm run typecheck -w @rocapine/community-ui` and expect a PASS.
- [ ] **Step 5: Commit** `feat(ui): "online" header item, the live online count`.

### Task 6: UI: "Activity status" switch in the profile edit sheet

**Files:**

- Modify: `packages/ui/src/screens/ProfileEditSheet.tsx` (a new section right after the badges section ending at line 451)

**Interfaces:**

- Consumes: `presenceSettings`, `usePresenceVisible` and `useSetPresenceVisible` from core; the keys `profile.activityStatus` and `profile.showOnline` from Task 4; and the existing `BadgeToggle({ label, value, onChange })`, which is already generic.

- [ ] **Step 1: Implement.** Render the section only when `presenceSettings(cfg)` is set and `usePresenceVisible()` is not null. It contains a label (`t("profile.activityStatus")`, `styles.label`) and one `BadgeToggle` with `label={t("profile.showOnline")}`, `value={visible}` and `onChange={(on) => setVisible.mutateAsync(on)}`. There is no helper text.
- [ ] **Step 2: Run** `npm test -w @rocapine/community-ui && npm run typecheck -w @rocapine/community-ui` and expect a PASS. The behaviour is covered by Task 3's mutation tests and Task 8's simulator check.
- [ ] **Step 3: Commit** `feat(ui): "Show when I'm online" switch in the profile edit sheet`.

### Task 7: Example app, docs, changeset

**Files:**

- Modify: `examples/expo-app/src/playground.ts` (a `presence` toggle in `settings.modules`, on by default, mapped to `modules.presence: {}`)
- Modify: `examples/expo-app/src/app/(tabs)/config.tsx` (the switch for it)
- Modify: `examples/expo-app/src/PlaygroundProvider.tsx` (`useEffect(() => startPresenceHeartbeat(resolved, AppState), [resolved])`, with `resolved` from `resolveConfig` or the hook)
- Modify: the example feed's `header` prop, to include `"online"` in a zone
- Modify: `docs/dashboard-roadmap.md` (coverage row "Online presence (presence)" at version 0.17, plus a brick: "Online now: the current online count on the dashboard home", size S)
- Modify: `docs/integration.md` (add `presence` to the `init --modules` lists; a Phase 3 note on `modules.presence`, `startPresenceHeartbeat(cfg, AppState)` and the `"online"` header item; a Phase 6 QA line)
- Modify: `packages/core/README.md`, `packages/ui/README.md` (a module section in each, in the style of badges)
- Create: `.changeset/online-presence.md` (minor for `@rocapine/community-core`, `@rocapine/community-ui` and `@rocapine/community`)

- [ ] **Step 1: Implement the example wiring and the docs.**
- [ ] **Step 2: Run** `npm run typecheck && npm test` at the repo root and expect everything to pass.
- [ ] **Step 3: Commit** `docs: presence module in the example app, integration guide and roadmap`.

### Task 8: SDK verification on the simulator, then the PR

- [ ] **Step 1:** Point the example app at the scratch project (Task 1 already applied the migration there). Launch it on an iOS simulator through Argent, with the Expo dev-menu params.
- [ ] **Step 2: Check each item against the spec.** Take a screenshot of each:
  - The pill opens expanded on a cold start and collapses to "● N" after 3 s.
  - Switching tabs or returning from the background does not expand it again; a tap expands it for 3 s.
  - The dot pulses only while the pill is expanded.
  - The own avatar has a dot in the feed, in the thread (comments and replies) and on the profile, where it pulses once.
  - Turning "Show when I'm online" off removes the own dot within one refetch, while the count stays the same.
  - With the module switched off in the config tab, there is no pill, no dot and no switch.
  - Both light and dark themes look right.
- [ ] **Step 3:** Record the walkthrough (`argent-screen-recording`) and compress it with `ffmpeg -i in.mp4 -vcodec libx264 -crf 28 -vf scale=-2:1280 -an out.mp4`.
- [ ] **Step 4:** Push `feat/online-presence` and open the PR with `gh pr create --attach ./walkthrough.mp4`. Put `![](./walkthrough.mp4)` alone on its own line in the body, and end the body with the attribution line. Then bind the PR (`ccd_pr`).
- [ ] **Step 5:** The 0.17.0 release follows the existing release-PR flow (as in `release: community 0.16.0 (#81)`). Ask Guillaume before publishing anything to npm.

### Task 9: Unchaind integration (repo `/Users/glsx/Developer/unchaind`, after 0.17.0 is on npm)

**Files:**

- Modify: `package.json` (`@rocapine/community-core` and `-ui` set to `^0.17.0`, then a clean `npm i`)
- Modify: `services/community/communityConfig.ts:69-80` (`modules.presence: {}`)
- Modify: `hooks/useCommunityIdentity.ts`. After `ensureIdentity` resolves, call `startPresenceHeartbeat(resolvedCommunityConfig, AppState)` and keep its stop function. The effect's cleanup calls it, and a cleanup that runs before the start resolves must keep the heartbeat from starting.
- Modify: `app/(blended)/community/index.tsx:72-86`, to `left: [{ logo, height: 32, accessibilityLabel: "Unchaind" }, "online"]`, `center: []`, `right: ["inbox", "profile"]`. This removes search, as intended.
- Create: a Supabase migration produced by `npx @rocapine/community upgrade --add-modules presence`
- Modify: `docs/features/COMMUNITY.md` (presence: the header, the heartbeat, the switch). If `docs/ANALYTICS.md` lists community events, add `community_presence_visibility_changed` there. The `onEvent` adapter already forwards every SDK event, so no code change is needed for it.

- [ ] **Step 1:** Work on a branch per `docs/WORKFLOW.md`. Make the changes above. Copy `.env.local` from the main repo into the worktree. Run `npm run typecheck && npm run lint && npm test` and expect them to pass.
- [ ] **Step 2:** Push the migration to the sandbox Supabase project; the refs are in the memory note `unchaind-community-sdk-migration.md`. Verify it with `supabase-tests/presence.sql` from the SDK, which must end with `PRESENCE_TESTS_PASSED`.
- [ ] **Step 3:** Run the Task 8 Step 2 checklist on the Unchaind dev build on the simulator, in both themes. Use Metro on 8082, because 8081 is Guillaume's session.
- [ ] **Step 4:** Record the walkthrough: the pill expanding and collapsing, the dots in the feed and the thread, the profile pulse, and the switch. Then open the PR with the video, following the PR-video rule.
- [ ] **Step 5:** Ask Guillaume in chat before pushing the migration to production. The app release ships it with no flag.
