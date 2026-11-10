# Community dashboard V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dashboard at `community.rocapi.ne` to review reported and AI-hidden content and manage members of the Unchaind community, in sandbox and production.

**Architecture:** A new repo `~/Developer/community-dashboard` modeled on `~/Developer/unchaind-dashboard`: a Vite + React SPA served as Worker static assets, and a hand-written Worker answering `/api/*`. The Worker checks the Cloudflare Access JWT, picks the community from the URL, and talks to that community's Supabase project with its secret key; the browser never talks to Supabase. Pure "planner" functions decide every write, so the rules are unit-tested without a database.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Tailwind v4, shadcn/ui (`radix-nova`), wouter (routing), TanStack Query, `@supabase/supabase-js` 2 (in the Worker only), Vitest 4 + happy-dom, Wrangler 4, oxlint.

**Spec:** `community-sdk/docs/superpowers/specs/2026-11-10-community-dashboard-v1-design.md`. Roadmap: `community-sdk/docs/dashboard-roadmap.md`. Mockups: `community-sdk/.superpowers/brainstorm/15422-1794330611/content/review-queue.html` (option A) and `members.html`.

## Global Constraints

- No change to the Community SDK; target the schema of SDK 0.15 as it is.
- The browser never receives a Supabase URL with a key, nor a key. Every data call is `/api/*`.
- Every `/api/*` response carries `cache-control: no-store` and is JSON.
- Every `/api/*` request needs a valid Access JWT, except when `DEV_ACCESS_EMAIL` is set, which only `.dev.vars` may do.
- The actor recorded everywhere (`moderation_actions.actor_email`, `reports.resolved_by`, `reviewed_by`) is the Access email.
- UI copy and code in English.
- UI principles: no page per feature; list + detail and panels using the screen's width; calm, modern, not showy.
- Production is marked by a 3px orange line across the top and an orange "Production" mark in the switcher; sandbox has neither.
- Write tests against **Unchaind sandbox** only (`vjcdpodsrpemanfvrshh`); production (`doiafuhoourjtqsmzook`) is read-only during development.
- Outward actions (creating the GitHub repo, creating Supabase secret keys, Cloudflare changes) need Guillaume's go before they are done.

## Review Focus

1. **Expired Access session:** `/api/*` answers 200 with an HTML login page; the app must reload the page, not crash or show "undefined". Test in Task 6.
2. **An item someone else already handled, or a retried action:** writes must stay correct when run twice or after another moderator acted (reports resolved only while `open`; an item deleted by its author returns 409). Test in Task 4.
3. **Restoring an admin post that asked to notify everyone:** without "Notify everyone now", `broadcast_requested = false` must be written _before_ `status = 'visible'`, or the push fires. Test in Task 4.
4. **Closing the tab or switching community during the 5-second Undo window:** pending writes are sent with `keepalive`, to the community they were made in. Test in Task 7.
5. **Search text with PostgREST metacharacters** (`,`, `(`, `)`, `%`, `*`, `.`): must not break or widen the filter. Test in Task 5.

---

## File structure (new repo `~/Developer/community-dashboard`)

```
CLAUDE.md                 points to the roadmap + UI principles in community-sdk
.impeccable.md            design context (audience, jobs, tone) from the spec
wrangler.jsonc            assets + run_worker_first ["/api/*"], vars COMMUNITIES, ACCESS_*, route
.dev.vars.example         DEV_ACCESS_EMAIL, SUPABASE_KEY_UNCHAIND_SANDBOX
index.html                theme pre-paint script (copied)
src/shared/types.ts       types shared by Worker and app (API contract)
src/worker/index.ts       fetch(): /api/* → router, else ASSETS
src/worker/env.ts         Env interface
src/worker/access.ts      Access JWT check
src/worker/communities.ts registry parsing and lookup
src/worker/supabase.ts    supabase-js client per community
src/worker/router.ts      route table, JSON helpers
src/worker/queue.ts       queue + item detail reads
src/worker/actions.ts     item action planner + runner
src/worker/members.ts     member reads, admin, ban/unban planner + runner
src/app/main.tsx, App.tsx routes, QueryClient
src/app/theme.ts          copied from unchaind-dashboard
src/app/api.ts            fetch wrapper (session-expired reload)
src/app/community.ts      community from URL, last community
src/app/shell/            Sidebar, CommunitySwitcher, ThemeToggle, Home
src/app/queue/            QueuePage, QueueList, ItemDetail, ActionBar, RestoreDialog, pendingActions.ts
src/app/members/          MembersPage, MembersList, MemberPanel, BanDialog, AdminSwitch
src/app/shared/           ItemView, AuthorSummary, LinkedBanNotice
src/components/ui/        shadcn components
test/                     Vitest tests, one file per module
```

---

### Task 1: Repo scaffold, theme, design tokens

**Files:**

- Create: everything at the repo root listed above, `src/app/main.tsx`, `src/app/App.tsx` (renders an empty shell), `src/app/index.css`, `src/app/theme.ts`, `test/theme.test.ts`
- Copy from `~/Developer/unchaind-dashboard`: `package.json` scripts and versions (drop `recharts`, `@fontsource-variable/geist`; add `@fontsource-variable/hanken-grotesk`, `wouter`, `@tanstack/react-query`, `@supabase/supabase-js`), `tsconfig*.json`, `vite.config.ts`, `components.json`, `index.html` script, `src/app/theme.ts`, `src/lib/utils.ts`

**Interfaces:**

- Produces: `nextThemeAction`, `toggleTheme`, `applyTheme`, `watchSystem` (same signatures as `unchaind-dashboard/src/app/theme.ts`); CSS variables for shadcn in `:root` and `.dark`, plus `--prod` and `--prod-foreground`.

- [ ] **Step 1:** `git init` in `~/Developer/community-dashboard`, add the files, `npm install`.
- [ ] **Step 2: Write `test/theme.test.ts`**

```ts
expect(nextThemeAction("light", "light")).toBe("dark");
expect(nextThemeAction("dark", "light")).toBe(null); // back to system: forget override
expect(nextThemeAction("dark", "dark")).toBe("light");
expect(nextThemeAction("light", "dark")).toBe(null);
```

- [ ] **Step 3:** Run `npx vitest run test/theme.test.ts`. Expected: PASS (the file is copied).
- [ ] **Step 4: Tokens in `src/app/index.css`.** Font `Hanken Grotesk Variable`. Light: background `oklch(98.6% 0.004 85)`, card `oklch(100% 0.002 85)`, border `oklch(91% 0.006 85)`, foreground `oklch(24% 0.012 270)`, muted-foreground `oklch(52% 0.012 270)`, primary `oklch(47% 0.12 265)`, destructive `oklch(55% 0.18 27)`, `--prod: oklch(68% 0.16 55)`. Dark: background `oklch(19% 0.01 270)`, card `oklch(22.5% 0.011 270)`, border `oklch(30% 0.012 270)`, foreground `oklch(93% 0.006 85)`, muted-foreground `oklch(72% 0.01 270)`, primary `oklch(74% 0.11 265)`, destructive `oklch(70% 0.15 27)`, `--prod: oklch(72% 0.15 60)`. Keep shadcn's `.dark` class variant.
- [ ] **Step 5:** Add shadcn components: `npx shadcn add button badge input tabs table dialog alert-dialog sheet switch tooltip sonner separator skeleton scroll-area checkbox textarea dropdown-menu`.
- [ ] **Step 6:** Write `CLAUDE.md` (points to `../community-sdk/docs/dashboard-roadmap.md`, its UI principles, and the rule: update the roadmap when a brick moves) and `.impeccable.md` (audience: the Rocapine team; jobs: moderate, manage members, later publish and measure; tone: calm, precise, not showy; the tokens above).
- [ ] **Step 7:** Run `npm run build && npm run lint && npx vitest run`. Expected: all pass.
- [ ] **Step 8:** Commit `chore: scaffold community dashboard`.

---

### Task 2: Worker foundation — Access, registry, router, shared types

**Files:**

- Create: `src/shared/types.ts`, `src/worker/{env,access,communities,supabase,router,index}.ts`, `wrangler.jsonc`, `.dev.vars.example`
- Test: `test/access.test.ts`, `test/communities.test.ts`, `test/router.test.ts`

**Interfaces:**

- Produces (`src/worker/env.ts`):
  `interface Env { ASSETS: Fetcher; COMMUNITIES: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; DEV_ACCESS_EMAIL?: string; [secret: string]: unknown }`
- Produces (`src/worker/access.ts`): `verifyAccess(req: Request, env: Env): Promise<string | null>` (the email, or null). RS256, keys from `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` (`keys` JWKS, matched by `kid`, cached in module scope for 10 minutes), `aud` must contain `ACCESS_AUD`, `exp` in the future, email from `email` claim. If `DEV_ACCESS_EMAIL` is set, return it without checking.
- Produces (`src/worker/communities.ts`):
  `interface Community { app: string; env: "prod" | "sandbox"; name: string; supabaseUrl: string; keySecret: string; amplitudeUserUrl?: string; revenuecatCustomerUrl?: string }`
  `parseCommunities(env: Env): Community[]` (throws on invalid JSON or missing fields),
  `findCommunity(env: Env, app: string, envName: string): Community | null`,
  `toPublic(c: Community): PublicCommunity` (drops `keySecret`, `supabaseUrl`).
  URL templates use `{id}`.
- Produces (`src/worker/supabase.ts`): `clientFor(env: Env, c: Community): SupabaseClient` (`auth: { persistSession: false }`; key read from `env[c.keySecret]`, throws if missing).
- Produces (`src/worker/router.ts`): `handleApi(req: Request, env: Env): Promise<Response>`; `json(data: unknown, status = 200): Response` (adds `no-store`); routes from spec "API sketch", all community routes under `/api/c/:app/:env/`; unknown community → 404 `{ error: "unknown_community" }`; no email → 401 `{ error: "unauthorized" }`.
- Produces (`src/shared/types.ts`): `PublicCommunity { app; env; name; hasAmplitude: boolean; hasRevenuecat: boolean }` and the API types of Tasks 3–5 (declared there, all in this file).

`wrangler.jsonc`: `name: "community-dashboard"`, assets as in unchaind-dashboard (`run_worker_first: ["/api/*"]`, SPA fallback), `routes: [{ pattern: "community.rocapi.ne", custom_domain: true }]`, `observability.enabled`, vars `ACCESS_TEAM_DOMAIN: "rocapine.cloudflareaccess.com"`, `ACCESS_AUD` (filled in Task 9), `COMMUNITIES` as a JSON string with the two Unchaind entries of the spec (`keySecret` `SUPABASE_KEY_UNCHAIND_PROD` / `SUPABASE_KEY_UNCHAIND_SANDBOX`).

- [ ] **Step 1: Write `test/access.test.ts`** with a key pair from `crypto.subtle.generateKey` (RSASSA-PKCS1-v1_5, SHA-256) and `fetch` stubbed to serve its JWK:
  - `valid token → "a@rocapine.com"`
  - `wrong aud → null`, `expired → null`, `unknown kid → null`, `tampered signature → null`, `no header → null`
  - `DEV_ACCESS_EMAIL set → returns it with no header`
- [ ] **Step 2: Write `test/communities.test.ts`:** two entries parse; `findCommunity(env, "unchaind", "prod")` returns the prod one; `"unchaind","staging"` → null; `toPublic` has no `keySecret` nor `supabaseUrl`; invalid JSON throws.
- [ ] **Step 3: Write `test/router.test.ts`:** `GET /api/communities` without a token → 401; with `DEV_ACCESS_EMAIL` → 200, JSON list, `cache-control: no-store`; `GET /api/c/unchaind/staging/summary` → 404 `unknown_community`.
- [ ] **Step 4:** Run `npx vitest run test/access.test.ts test/communities.test.ts test/router.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 5:** Implement the files above; `index.ts` sends `/api/*` to `handleApi` and the rest to `env.ASSETS.fetch(req)`.
- [ ] **Step 6:** Run the three tests. Expected: PASS. Run `npm run build`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(worker): access check, community registry, router`.

---

### Task 3: Review queue reads

**Files:**

- Create: `src/worker/queue.ts`; add types to `src/shared/types.ts`; routes in `router.ts`
- Test: `test/queue.test.ts`

**Interfaces:**

- Consumes: `clientFor`, `Community`, `json`.
- Produces (types):
  `type Kind = "post" | "comment"`; `type QueueFilter = "all" | "reported" | "ai_hidden"`;
  `type ReportReason = "spam" | "harassment" | "hate" | "inappropriate" | "other"`;
  `interface QueueRow { kind; id; topic: string | null; text: string; createdAt: string; status: "visible" | "hidden" | "pending"; openReports: number; mainReason: ReportReason | null; lastReportAt: string | null; aiReason: string | null; authorId: string }`;
  `interface ItemView { kind; id; text; imageUrl: string | null; topic: string | null; status; createdAt; author: { id; name: string | null; handle: string | null } }`;
  `interface ReportView { id; reason: ReportReason; details: string | null; reporter: { id; name: string | null }; createdAt; status: "open" | "resolved"; resolution: string | null }`;
  `interface ModerationEntry { id; action: string; actorEmail: string; note: string | null; createdAt }`;
  `interface AuthorSummary { id; name; handle; avatarUrl: string | null; joinedAt; isBanned; isAdmin; isHouse; posts: number; comments: number; reportsReceived: number; hidden: number; linkedBan: LinkedBan | null }`;
  `interface LinkedBan { profileId: string; name: string | null; via: "revenuecat" | "amplitude" }`;
  `interface ItemDetail { item: ItemView; parent: ItemView | null; replyTo: ItemView | null; reports: ReportView[]; aiReason: string | null; history: ModerationEntry[]; author: AuthorSummary; broadcastPending: boolean }`;
  `interface Summary { openReports: number; aiHiddenToReview: number }`.
- Produces (functions):
  `buildQueue(input: { openReports: OpenReportRow[]; aiHidden: ItemRow[]; items: Map<string, ItemRow> }, filter: QueueFilter): QueueRow[]` — pure;
  `getQueue(sb, filter): Promise<QueueRow[]>`, `getItem(sb, c: Community, kind, id): Promise<ItemDetail | null>`, `getSummary(sb): Promise<Summary>`, `getAuthorSummary(sb, profileId): Promise<AuthorSummary>` (also used by Task 5), `imageUrl(c, path: string | null): string | null` = `${supabaseUrl}/storage/v1/object/public/post-images/${path}`.
- Routes: `GET summary`, `GET queue?filter=`, `GET items/:kind/:id`.

Queue rules (spec "What is in the queue"): an item is in when it has ≥1 open report and its status is not `deleted`, or `status = 'hidden' and moderation_reason is not null and reviewed_at is null`. Order: reported items first by `openReports` desc then `lastReportAt` desc; then AI-hidden by `createdAt` desc. `mainReason` = most frequent open reason, ties broken by the most recent report. No paging in V1 (the queue is small); cap at 200 rows.

`broadcastPending` = post with `broadcast_requested = true and broadcast_at is null`. `linkedBan`: another profile with `is_banned = true` and the same non-null `revenuecat_id` (checked first) or `amplitude_id`.

- [ ] **Step 1: Write `test/queue.test.ts` for `buildQueue`:**
  - item with 2 open reports (harassment, harassment) and one with 3 (spam) → the 3-report item first, `mainReason` `"spam"`
  - reported item with `status: "deleted"` → absent
  - AI-hidden item with `reviewed_at` set → absent; without → present, `aiReason` set, after reported items
  - an item both reported and AI-hidden appears once
  - filter `"reported"` keeps only items with `openReports > 0`; `"ai_hidden"` only items with `aiReason` and no review
  - `imageUrl(c, "a/b.jpg")` → `"https://vjcdpodsrpemanfvrshh.supabase.co/storage/v1/object/public/post-images/a/b.jpg"`; `imageUrl(c, null)` → null
- [ ] **Step 2:** Run `npx vitest run test/queue.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `queue.ts` (fetchers are thin supabase-js queries feeding `buildQueue`; `admin_user_stats` read for one author at a time).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Run `npx wrangler dev` with `.dev.vars` (sandbox key, `DEV_ACCESS_EMAIL`), `curl localhost:8787/api/c/unchaind/sandbox/queue`. Expected: JSON array (possibly empty). Same for `summary`.
- [ ] **Step 6:** Commit `feat(worker): review queue reads`.

---

### Task 4: Item actions

**Files:**

- Create: `src/worker/actions.ts`; route in `router.ts`; types in `src/shared/types.ts`
- Test: `test/actions.test.ts`

**Interfaces:**

- Consumes: `clientFor`, `getItem` (to read state before acting).
- Produces:
  `type ItemAction = "hide" | "keep_hidden" | "restore" | "reject_reports"`;
  `type Write = { op: "update"; table: "posts" | "comments" | "reports" | "profiles"; match: Record<string, string | boolean>; patch: Record<string, unknown> } | { op: "insert"; table: "moderation_actions"; row: Record<string, unknown> }`;
  `planItemAction(input: { kind: Kind; id: string; authorId: string; status: string; broadcastPending: boolean; action: ItemAction; actor: string; now: string; notifyEveryone?: boolean }): Write[] | { error: "deleted" | "not_allowed" }` — pure;
  `runWrites(sb, writes: Write[]): Promise<{ updated: number[] }>` — executes in order, stops at the first error and throws it;
  route `POST items/:kind/:id/actions` body `{ action: ItemAction; notifyEveryone?: boolean }` → 200 `{ ok: true }`, 409 `{ error: "deleted" }`, 400 `{ error: "not_allowed" }`, 404 if the item does not exist.

Writes per action are the spec's table ("What each action writes"). Every report update matches `{ [kind === "post" ? "post_id" : "comment_id"]: id, status: "open" }`. Every log row has `actor_email`, `action`, `target_post_id` or `target_comment_id`, **and `target_user_id: authorId`** (so a member's Moderation tab is one query on `target_user_id`). The log insert is always the last write. `not_allowed`: `restore`/`keep_hidden` on a visible item, `hide` on a hidden one.

- [ ] **Step 1: Write `test/actions.test.ts` for `planItemAction`:**
  - `hide` on a visible post → `[update posts {id} {status:"hidden", reviewed_at, reviewed_by}, update reports {post_id, status:"open"} {status:"resolved", resolution:"content_hidden", resolved_at, resolved_by}, insert moderation_actions {action:"hide", target_post_id, target_user_id}]`
  - `keep_hidden` on a hidden comment → no status change, reports `content_hidden`, log `confirm_hide`, report match uses `comment_id`
  - `restore` → `status:"visible"`, reports `rejected`, log `restore`
  - `reject_reports` → reviewed fields only, reports `rejected`, log `reject_report`
  - `restore` with `broadcastPending: true` and no `notifyEveryone` → first write is `update posts {id} {broadcast_requested: false}`, before the status write (Review Focus 3)
  - same with `notifyEveryone: true` → no `broadcast_requested` write
  - any action on `status: "deleted"` → `{ error: "deleted" }` (Review Focus 2)
  - `hide` on a hidden item → `{ error: "not_allowed" }`
  - every report update's `match` contains `status: "open"` (Review Focus 2: a retry resolves nothing twice)
- [ ] **Step 2:** Run `npx vitest run test/actions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `planItemAction`, `runWrites` (supabase-js `.update(patch).match(match)` / `.insert(row)`), the route (actor from `verifyAccess`, `now = new Date().toISOString()`).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** On sandbox via `wrangler dev`: create a post and a report from the Unchaind sandbox app (or SQL in the sandbox), `POST …/actions {action:"hide"}`, then check in SQL: post `hidden` with `reviewed_by`, report `resolved` / `content_hidden`, one `moderation_actions` row with `target_user_id`. Run it a second time: 400 `not_allowed`, no new log row.
- [ ] **Step 6:** Commit `feat(worker): item actions`.

---

### Task 5: Members reads, admin, ban and unban

**Files:**

- Create: `src/worker/members.ts`; routes; types
- Test: `test/members.test.ts`

**Interfaces:**

- Consumes: `getAuthorSummary`, `runWrites`, `Write`, `planItemAction`.
- Produces (types):
  `type MemberFilter = "active" | "everyone" | "admins" | "reported" | "banned" | "team"`;
  `interface MemberRow { id; name; handle; avatarUrl; isAdmin; isBanned; isHouse; posts; comments; reportsReceived; joinedAt }`;
  `interface MemberPage { rows: MemberRow[]; nextCursor: string | null }`;
  `interface Member extends AuthorSummary { bio: string | null; amplitudeId: string | null; revenuecatId: string | null; amplitudeUrl: string | null; revenuecatUrl: string | null; blockedBy: number; badges: Record<string, unknown> | null }`;
  `type MemberTab = "reports" | "posts" | "comments" | "moderation"`.
- Produces (functions):
  `parseMemberQuery(q: string): { kind: "id"; value: string } | { kind: "text"; value: string }` — a UUID → `id`; anything else → `text` with PostgREST metacharacters `,()*%.:` and backslash removed, trimmed, max 64 chars;
  `listMembers(sb, { q?: string; filter: MemberFilter; cursor?: string }): Promise<MemberPage>`;
  `getMember(sb, c, id): Promise<Member | null>`; `getMemberTab(sb, c, id, tab, cursor?): Promise<{ items: (ItemView | ReportView | ModerationEntry)[]; nextCursor: string | null }>`;
  `planBan(input: { profileId; actor; now; note?: string; hideContent: boolean; fromItem?: { kind; id; status; broadcastPending: false } }): Write[]` — pure;
  `planUnban(input: { profileId; actor; now }): Write[]`;
  routes `GET members`, `GET members/:id`, `GET members/:id/:tab`, `POST members/:id/admin {value: boolean}`, `POST members/:id/ban {note?, hideContent, fromItem?}`, `POST members/:id/unban`.

List rules:

- `text` search: `or=(username.ilike.*v*,handle.ilike.*v*)`; `id` search: `id = v` or `amplitude_id = v` or `revenuecat_id = v` (an exact non-UUID string also tries `amplitude_id`/`revenuecat_id` equality).
- `active` (default): members by **latest activity**: merge the newest 100 posts, 100 comments and 100 reports (`reported_user_id`) by `created_at`, keep the first 50 distinct authors; `nextCursor` = the oldest `created_at` used. `reported`: same from reports only. `everyone`: `profiles` by `created_at desc`. `admins` / `banned` / `team`: `profiles` where `is_admin` / `is_banned` / `is_house`.
- Counts for the page's 50 ids from `admin_user_stats` with `id=in.(…)`; `is_admin`, `handle`, `bio`, `avatar_url`, `visible_badges` from `profiles`. Never filter or sort on `admin_user_stats` (its counts are unindexed subqueries).
- `visible_badges` exists only when the badges module is installed: on a "column does not exist" error, read the profile again without it and return `badges: null`.
- `amplitudeUrl` / `revenuecatUrl`: the community's template with `{id}` replaced (URL-encoded); null if the id or the template is missing.

Ban writes (spec brick 3): `update profiles {id} {is_banned: true}`; `update reports {reported_user_id: id, status: "open"} {status: "resolved", resolution: "user_banned", resolved_at, resolved_by}`; if `fromItem`, that item's hide writes (from `planItemAction`, without its log row); if `hideContent`, `update posts {author_id: id, status: "visible"} {status: "hidden", reviewed_at, reviewed_by}` and the same for comments; last, log `ban` with `target_user_id` and `note` = the note plus `"hid N items"` when N > 0 (the runner fills N from the updated row counts). Unban: `is_banned: false`, log `unban`. Admin: `update profiles {id} {is_admin: value}`, no log (spec).

- [ ] **Step 1: Write `test/members.test.ts`:**
  - `parseMemberQuery("8f3c1e2a-…-a91e")` → `{ kind: "id" }`
  - `parseMemberQuery("jordan),is_admin.eq.true,(")` → `{ kind: "text", value: "jordanis_admineqtrue" }` (Review Focus 5)
  - `parseMemberQuery("  Sarah  ")` → `{ kind: "text", value: "Sarah" }`
  - `planBan({ hideContent: false })` → profiles update, reports update with `status: "open"` match, log last with `action: "ban"`
  - `planBan({ hideContent: true })` → also posts and comments updates matching `status: "visible"`, before the log
  - `planBan({ fromItem })` → contains the item's hide write and its reports are resolved as `user_banned`, not `content_hidden`
  - `planUnban` → `is_banned: false`, log `unban`, no content writes
- [ ] **Step 2:** Run `npx vitest run test/members.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `members.ts` and routes.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** On sandbox via `wrangler dev`: list `active`, search a handle, open a member, ban with `hideContent: true`, check rows in SQL, unban. Time `GET members?filter=everyone` on **production** (read-only). Expected: under 1.5 s; if not, stop and report.
- [ ] **Step 6:** Commit `feat(worker): members, admin, ban`.

---

### Task 6: App shell — routing, API client, switcher, home

**Files:**

- Create: `src/app/{App,api,community}.ts(x)`, `src/app/shell/{Sidebar,CommunitySwitcher,ThemeToggle,Home}.tsx`
- Test: `test/api.test.ts`, `test/community.test.ts`

**Interfaces:**

- Consumes: API routes of Tasks 2–5, `toggleTheme`, `PublicCommunity`, `Summary`.
- Produces:
  `apiGet<T>(path: string): Promise<T>`, `apiPost<T>(path: string, body: unknown, init?: { keepalive?: boolean }): Promise<T>` — when the response is not `application/json`, call `onSessionExpired()` (default `location.reload()`) and reject; non-2xx JSON → throw `ApiError { status; code }`;
  `communityPath(c: { app: string; env: string }, rest = ""): string` → `/unchaind/prod/queue`;
  `lastCommunity(): { app; env } | null`, `rememberCommunity(c)` (localStorage key `community`, wrapped in try/catch);
  `useCommunity(): PublicCommunity` (from the route params; unknown → redirect to `/`).
- Routes (wouter): `/` → redirect to the last community or the first prod one; `/:app/:env` → Home; `/:app/:env/queue/:kind?/:id?`; `/:app/:env/members/:id?`.

Layout per spec brick 1 and the mockups: sidebar 196px (switcher, nav with the queue count from `summary`, footer "Signed in with Cloudflare Access" + `ThemeToggle`), content to the right. The prod line is a 3px `--prod` bar above everything when `env === "prod"`. Home: the two counts from `summary`, each a link to `queue?filter=reported` / `queue?filter=ai_hidden`.

- [ ] **Step 1: Write `test/api.test.ts`** (fetch stubbed): HTML 200 → `onSessionExpired` called once and the promise rejects (Review Focus 1); JSON 409 `{error:"deleted"}` → `ApiError` with `status 409, code "deleted"`; `apiPost(…, { keepalive: true })` passes `keepalive: true` to fetch.
- [ ] **Step 2: Write `test/community.test.ts`:** `communityPath({app:"unchaind",env:"prod"}, "queue")` → `"/unchaind/prod/queue"`; `rememberCommunity` then `lastCommunity` round-trips; `lastCommunity()` with a throwing `localStorage` → null.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement; wrap the app in `QueryClientProvider` (`staleTime: 30_000`, `refetchOnWindowFocus: true`), `TooltipProvider`, `Toaster` (sonner).
- [ ] **Step 5:** Run both tests. Expected: PASS. `npm run build` passes.
- [ ] **Step 6:** `npx wrangler dev` after `npm run build`: open the app, switch prod / sandbox, check the orange line only in prod, toggle the theme, reload (theme kept, no flash).
- [ ] **Step 7:** Commit `feat(app): shell, switcher, home`.

---

### Task 7: Review queue UI

**Files:**

- Create: `src/app/queue/{QueuePage,QueueList,ItemDetail,ActionBar,RestoreDialog}.tsx`, `src/app/queue/pendingActions.ts`, `src/app/shared/{ItemView,AuthorSummary,LinkedBanNotice}.tsx`
- Test: `test/pendingActions.test.ts`, `test/queueKeys.test.tsx`

**Interfaces:**

- Consumes: `apiGet`, `apiPost`, `QueueRow`, `ItemDetail`, `ItemAction`, `communityPath`.
- Produces:
  `createPendingActions(send: (p: PendingAction) => Promise<void>, delayMs = 5000): { add(p: PendingAction): string; undo(id: string): boolean; flushAll(keepalive: boolean): void }` where `PendingAction = { path: string; body: unknown; label: string }` — `path` already contains the community, so a community switch cannot redirect it (Review Focus 4);
  `ItemView`, `AuthorSummary` components reused by Task 8; `AuthorSummary` has an `onOpenMember(id)` prop.

Behavior per spec brick 2 and `review-queue.html` option A: list (340px) on the left with the All / Reported / AI-hidden segmented control (`?filter=`); detail on the right with context, reports, AI reason, history, author summary; action bar at the bottom with the buttons of the spec's table. Selecting an item updates the URL. Keyboard (ignored while typing in an input or a dialog is open): `j`/`k` next/previous, `h` Hide or Keep hidden, `r` Reject reports or Restore, `b` opens the ban dialog, `Escape` closes the member panel. An action removes the row at once (optimistic, via the query cache), selects the next row, and shows a sonner toast `"<Kind> hidden"` etc. with **Undo** for 5 s. `RestoreDialog` opens instead when `broadcastPending`: checkbox "Notify everyone now", unchecked. `pagehide` calls `flushAll(true)`. A failed send shows an error toast with Retry and puts the row back. `LinkedBanNotice`: "Another profile with the same RevenueCat id is banned" (or Amplitude), linking to that member.

- [ ] **Step 1: Write `test/pendingActions.test.ts`** (fake timers):
  - `add` then 4999 ms → `send` not called; 5000 ms → called once
  - `add` then `undo(id)` → returns true, `send` never called
  - two `add`s then `flushAll(true)` → both sent at once, with `keepalive` (Review Focus 4), timers cleared
  - `add` with path `/api/c/unchaind/prod/items/post/1/actions`, the app then switching community, then 5000 ms → sent to that same prod path
- [ ] **Step 2: Write `test/queueKeys.test.tsx`** (happy-dom): with three rows, `j` selects the second; `k` back to the first; `h` while focus is in an `<input>` does nothing.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run both. Expected: PASS.
- [ ] **Step 6:** On sandbox in the browser: hide, undo, hide and wait, reject, restore an AI-hidden post, restore a post with `broadcast_requested = true` (set in SQL) without ticking → check `broadcast_requested = false` and no push sent. Close the tab within 5 s of an action → the write is in the database.
- [ ] **Step 7:** Commit `feat(app): review queue`.

---

### Task 8: Members UI

**Files:**

- Create: `src/app/members/{MembersPage,MembersList,MemberPanel,BanDialog,AdminSwitch}.tsx`; modify `src/app/queue/QueuePage.tsx` (member panel as a sheet over the detail)
- Test: `test/banDialog.test.tsx`

**Interfaces:**

- Consumes: `apiGet`, `apiPost`, `Member`, `MemberPage`, `MemberFilter`, `MemberTab`, `ItemView`, `AuthorSummary`, `LinkedBanNotice`.
- Produces: `MemberPanel({ communityPath, memberId, onClose?, onOpenItem })` — the one panel used in both places.

Behavior per spec brick 3 and `members.html`: list + panel side by side (panel 400px); search box (debounced 250 ms, `?q=`), filter chips Active (default) / Everyone / Admins / Reported / Banned / Team accounts; table columns per spec; "Load more" with `nextCursor`; selected member in the URL. Panel: header, bio, counts, user id with copy, Amplitude / RevenueCat links (hidden when null), blocked by, badges, `LinkedBanNotice`, tabs Reports / Posts / Comments / Moderation (paged), footer `AdminSwitch` + Ban / Unban. In the queue, "Open member" opens `MemberPanel` in a `Sheet` anchored right over the detail area (~82% of its width), "Back to the item" and Esc close it; the queue keeps its selection. Clicking an item in the panel's tabs shows it with `ItemView` inside the panel. `AdminSwitch`: turning on in **prod** asks for confirmation ("<name> will be able to post in admin-only topics, pin and notify everyone."); sandbox and turning off do not. `BanDialog`: optional note, checkbox "Also hide their visible posts and comments" checked by default, sends `fromItem` when opened from the queue.

- [ ] **Step 1: Write `test/banDialog.test.tsx`:** the checkbox starts checked; submitting sends `{ hideContent: true, note: "" }`; unchecking sends `hideContent: false`; opened with `fromItem` → body contains it.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expected: PASS. `npm run build && npm run lint && npx vitest run` all pass.
- [ ] **Step 5:** On sandbox in the browser: search, filters, open from the queue and back with Esc, make admin (no confirm in sandbox) and check `is_admin` in SQL, ban with content hidden then unban.
- [ ] **Step 6:** Commit `feat(app): members`.

---

### Task 9: Ship — repo, Cloudflare, secrets, end-to-end check

**Files:**

- Modify: `wrangler.jsonc` (`ACCESS_AUD`, URL templates), `README.md` (setup, secrets, local dev)
- Modify (in `community-sdk`): `docs/dashboard-roadmap.md`

Each outward step is announced to Guillaume and done only after his go.

- [ ] **Step 1:** Create `Rocapine/community-dashboard` (private) with `gh repo create`, push `main`.
- [ ] **Step 2:** In each Unchaind Supabase project (sandbox, then production), create a secret key named `community-dashboard`; set them with `npx wrangler secret put SUPABASE_KEY_UNCHAIND_SANDBOX` / `…_PROD`. Never print the values.
- [ ] **Step 3:** Check with `npx wrangler whoami` that the "Rocapine" account (`cd3f38fcaf8dca226a6c08ebc2616089`) is reachable and holds the `rocapi.ne` zone. If not, stop and ask.
- [ ] **Step 4:** Create the Access application for `community.rocapi.ne` (rule: emails ending in `@rocapine.com`), put its AUD in `ACCESS_AUD`. If the credentials lack the rights, give Guillaume the exact dashboard steps and wait.
- [ ] **Step 5:** Connect Workers Builds to the repo (deploy on `main`), deploy once.
- [ ] **Step 6:** Fill `amplitudeUserUrl` and `revenuecatCustomerUrl` with Unchaind's Amplitude project and RevenueCat project (ask Guillaume for the ids if not found in the Unchaind repo).
- [ ] **Step 7: End-to-end check:** from a `@rocapine.com` account, `community.rocapi.ne` opens; from another account, Access refuses. On sandbox: one full pass of hide, undo, restore, reject, ban, unban, admin. On production: read-only look at the queue and members.
- [ ] **Step 8:** Update `community-sdk/docs/dashboard-roadmap.md`: bricks 1–3 _done_ with the dashboard repo's commit or PR links; "Last reviewed" date. Commit on the `docs/community-dashboard-roadmap` branch.
- [ ] **Step 9:** Commit the dashboard changes `chore: deploy config`, push.
