# Brick 5, Amendment 1 (Activity page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Activity its own page with more panels, keep a four-card overview on Home, and back it with an extended `admin_daily_metrics`, a new `admin_activity_breakdown` and `created_at` indexes.

**Architecture:** Two repos. The SDK (`community-sdk`, branch `feat/dashboard-activity`) changes the unpushed `core/017_activity_metrics.sql` in place. The dashboard (`community-dashboard`, branch `claude/brick5-activity-fe1b44`) adds one Worker route, a lazy-loaded page, the sidebar item, and new panels built from Bklit components copied into `src/components/charts`.

**Tech Stack:** Postgres plpgsql, Cloudflare Worker, React 19, TanStack Query, wouter, Tailwind v4, Bklit UI (shadcn registry `@bklit`), vitest + Testing Library.

**Spec:** `community-sdk/docs/superpowers/specs/2026-11-12-community-dashboard-brick5-design.md`, section "Amendment 1" (it overrides older sections where they disagree).

## Global Constraints

- House accounts (`profiles.is_house`) are out of every number. A missing optional module (`poll_votes`, `post_reactions`) gives `null`, never 0.
- Both functions: service role only (`revoke execute ... from public, anon, authenticated`), an unknown `tz` raises `invalid_time_zone` with errcode `22023`, days are counted in `tz`.
- 017 stays one file, fully idempotent (`create or replace`, `create index if not exists`, module tables guarded with `to_regclass`). The CLI's migration count does not change.
- Production `doiafuhoourjtqsmzook` is read-only. SQL runs on the sandbox only: `supabase db query --linked --project-ref vjcdpodsrpemanfvrshh --yes -f <file>`, one statement per file.
- UI copy in English. Colour never carries meaning alone (▲ / ▼ and a sign on every change, a label on every series). Theme through `--chart-*` tokens in `src/app/index.css`; edit a copied Bklit file only where tokens can't reach.
- No refactor of `communities.ts`, `access.ts` or the registry. A Supabase key never reaches the browser.
- Stage files by name; never `git add -A`. Commit with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line. No push.

## Review Focus

1. A period with no eligible reply → median first reply is `null` and shown as "—", with no change line (Task 1 SQL test, Task 4 card test).
2. A community without the polls / reactions modules → active members still counted from posts, comments and likes; no crash in the breakdown (Task 1 and Task 2 SQL tests drop the module tables inside the rolled-back block).
3. Posts by house accounts are top in likes → not in "Most engaged posts" (Task 2 SQL test).
4. Median first reply going down → shown as good (green token, ▼), not bad (Task 3 format test).
5. The probe is off (old SDK) → the page shows only "Activity needs the latest community SDK." and makes no breakdown call (Task 4 test).

---

### Task 1: SDK, `admin_daily_metrics` gains members and first reply; indexes

**Files:**

- Modify: `supabase/migrations/core/017_activity_metrics.sql`
- Modify: `supabase-tests/activity-metrics.sql`

**Interfaces:**

- Produces, in the function's JSON: `daily[].new_members`, `daily[].active_members` (ints); top level `new_members` (int), `active_members` (int), `members_total` (int), `median_first_reply_minutes` (number or null).

- [ ] **Step 1: Write the failing assertions** in `activity-metrics.sql`, inside its rolled-back block, with fixtures the file already builds (add rows as needed):
  - a non-house profile created inside the window counts in `new_members` and in that day's `daily[].new_members`; a house profile created that day does not.
  - a member who only liked a post on day D counts in `daily[D].active_members` and in `active_members`; a house account who posted does not.
  - `members_total` = non-house profiles created before the window's end.
  - posts replied after 10, 30 and 90 minutes (by someone else, not deleted) give `median_first_reply_minutes = 30`; a self-reply and a deleted reply are ignored; a window with no replied eligible post gives `null`.
  - with `poll_votes` and `post_reactions` dropped (inside the block), the call still succeeds and `active_members` counts posters, commenters and likers.
- [ ] **Step 2: Run** `supabase db query --linked --project-ref vjcdpodsrpemanfvrshh --yes -f supabase-tests/activity-metrics.sql`. Expected: an assertion error, not `ACTIVITY_METRICS_TESTS_PASSED`.
- [ ] **Step 3: Implement** in 017:
  - Optional modules: have the dynamic `extra` query also return the distinct `(user_id, day)` pairs, so daily active members include voters and reactors.
  - `new_members`: non-house `profiles.created_at` in the window, per day and in total. `members_total`: non-house profiles with `created_at < t1`.
  - `active_members`: distinct non-house users with a post, comment, like, comment like, poll vote or reaction (per day and over the period).
  - `median_first_reply_minutes`: `percentile_cont(0.5)` over eligible posts (`created_at <= now() - 24 h`) of the minutes to their first non-deleted comment by someone other than the author; null when none.
  - Indexes: `create index if not exists ... (created_at)` on `posts`, `comments`, `likes`, `comment_likes`, `profiles`, `reports`; on `poll_votes` and `post_reactions` inside a `do` block guarded by `to_regclass`. Update the header comment.
- [ ] **Step 4: Apply and run** on the sandbox: apply 017 (`-f supabase/migrations/core/017_activity_metrics.sql`; if the CLI refuses several statements, split into temporary single-statement files in the scratchpad), then run the test file. Expected: `ACTIVITY_METRICS_TESTS_PASSED`. Then `npm test -w packages/cli`: 53/53.
- [ ] **Step 5: Commit** `017_activity_metrics.sql`, `activity-metrics.sql`: `feat(core): activity metrics add members, active members, median first reply; created_at indexes`.

### Task 2: SDK, `admin_activity_breakdown`

**Files:**

- Modify: `supabase/migrations/core/017_activity_metrics.sql` (second function, same file)
- Create: `supabase-tests/activity-breakdown.sql` (same shape as `activity-metrics.sql`; raises `ACTIVITY_BREAKDOWN_TESTS_PASSED`)

**Interfaces:**

- Produces `public.admin_activity_breakdown(from_date date, to_date date, tz text default 'UTC') returns jsonb`. The previous period is the same number of days just before `from_date`. Shape:

```json
{
  "tz": "Europe/Paris",
  "heatmap": [[0, 0, "... 24 ints, hour 0..23"], "... 7 rows, Monday first"],
  "languages": [
    { "locale": "en", "count": 120 },
    { "locale": null, "count": 4 }
  ],
  "moderation": {
    "reports": 3,
    "ai_hidden": 9,
    "team_actions": 5,
    "previous": { "reports": 1, "ai_hidden": 4, "team_actions": 2 }
  },
  "returning": { "previous_contributors": 80, "returned": 31 },
  "top_posts": [
    {
      "id": "uuid",
      "excerpt": "first 140 chars",
      "topic": "prayer-requests",
      "author_id": "uuid",
      "author_name": "john",
      "likes": 40,
      "comments": 12,
      "created_at": "2026-11-08T10:00:00Z"
    }
  ]
}
```

- [ ] **Step 1: Write the failing test file**, asserting, with posts and comments by non-house members (house rows added each time to prove they are left out):
  - `heatmap`: a post at Monday 09:30 and a comment at Sunday 23:10, both in `tz` = `Europe/Paris`, land in `heatmap[0][9]` and `heatmap[6][23]`; posts and comments with status `deleted` don't count.
  - `languages`: counts posts + comments by author `profiles.locale`, sorted by count desc then locale; a null locale is one row with `locale: null`.
  - `moderation`: `reports` by `reports.created_at`; `ai_hidden` = posts + comments with `status = 'hidden'` and `reviewed_at is null`, by `moderated_at`; `team_actions` = `moderation_actions` rows by `created_at`; `previous` the same over the previous period.
  - `returning`: a member who posted in both periods counts in `returned`; one who posted only before counts only in `previous_contributors`.
  - `top_posts`: at most 5, posts created in the window and not deleted, ordered by likes + non-deleted comments desc, then `created_at` desc; a house account's post with the most likes is absent; `excerpt` is at most 140 characters.
  - unknown `tz` raises errcode `22023`; `from_date > to_date` returns empty arrays and zero counts.
- [ ] **Step 2: Run** the new file on the sandbox (before the function exists). Expected: `function ... does not exist`.
- [ ] **Step 3: Implement** the function in 017 (`language plpgsql stable set search_path = public`), same zone check and window as `admin_daily_metrics`, then the `revoke`.
- [ ] **Step 4: Apply 017 and run both test files** on the sandbox. Expected: `ACTIVITY_BREAKDOWN_TESTS_PASSED` and `ACTIVITY_METRICS_TESTS_PASSED`. `npm test -w packages/cli`: 53/53.
- [ ] **Step 5: Commit** both files: `feat(core): admin_activity_breakdown for the dashboard's Activity page`.

### Task 3: Dashboard Worker and shared types

**Files:**

- Modify: `src/shared/types.ts`, `src/worker/activity.ts`, `src/worker/router.ts`, `src/app/activity/format.ts`
- Modify: `test/activityRaw.ts`, `test/activity.test.ts`, `test/router.test.ts`, `test/activityFormat.test.ts`

**Interfaces:**

- Consumes: Task 1 and Task 2 JSON.
- Produces:
  - `DailyActivity` gains `newMembers: number; activeMembers: number`.
  - `ActivityMetrics` gains `newMembers: number; activeMembers: number; membersTotal: number; medianFirstReplyMinutes: number | null`.
  - `interface ActivityBreakdown { from: string; to: string; heatmap: number[][]; languages: { locale: string | null; count: number }[]; moderation: { reports: number; aiHidden: number; teamActions: number; previous: { reports: number; aiHidden: number; teamActions: number } }; returning: { previousContributors: number; returned: number }; topPosts: { id: string; excerpt: string; topic: string | null; authorId: string; authorName: string; likes: number; comments: number; createdAt: string }[] }`
  - `getBreakdown(sb, days: ActivityDays, tz: string, now = new Date()): Promise<ActivityBreakdown>` in `src/worker/activity.ts`, one RPC call over `periodBounds(days, tz, now)`.
  - Route `"GET activity/breakdown"` → `/api/c/:app/:env/activity/breakdown?days=&tz=`, same validation as `"GET activity"` (400 `bad_days`, `safeZone(tz, "UTC")`). Check how the router matches a two-segment path (`rest`) and follow it.
  - `change(cur, prev, unit, lowerIsBetter = false)` returns `{ text, dir, good: boolean | null }`; `good` is `null` when `dir` is `"flat"`, otherwise `(dir === "up") !== lowerIsBetter`. Every caller colours by `good`, the arrow stays from `dir`.
  - `minutes(n: number): string` in `format.ts`: under 60 → `"42 min"`, else hours with one decimal → `"3.5 h"` (`"24 h"` for whole numbers).
- [ ] **Step 1: Write failing tests:** `mapMetrics` maps the new snake_case fields (extend `RAW`); a `mapBreakdown` test maps `ai_hidden`, `team_actions`, `previous_contributors`, `top_posts[].author_name`, `created_at`; router: `GET .../activity/breakdown?days=8` → 400 `bad_days`, `days=30` calls `admin_activity_breakdown` with `from_date`, `to_date`, `tz`; `change(30, 60, "%", true)` → `{ text: "▼ −50 %", dir: "down", good: true }`; `change(5, 5, "%")` → `good: null`; `minutes(42)` → `"42 min"`, `minutes(210)` → `"3.5 h"`, `minutes(1440)` → `"24 h"`.
- [ ] **Step 2: Run** `npx vitest run test/activity.test.ts test/router.test.ts test/activityFormat.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the types, `mapMetrics` fields, `mapBreakdown(raw): Omit<ActivityBreakdown, "from" | "to">`, `getBreakdown`, the route, `change` and `minutes`. Update `StatCardArea` and the Contributions table to colour from `good`.
- [ ] **Step 4: Run** `npm test` and `npx tsc -b`. Expected: all pass (454 + new), no type errors.
- [ ] **Step 5: Commit** the files above: `feat(worker): activity breakdown route, members and first reply fields`.

### Task 4: The Activity page, the sidebar item, Home's overview

**Files:**

- Create: `src/app/activity/ActivityPage.tsx`, `src/app/activity/useActivityDays.ts`, `src/app/activity/ActivityOverview.tsx`
- Modify: `src/app/activity/ActivitySection.tsx` (split: its cards move to a shared `ActivityCards` export; the section itself is removed once the page and overview use the parts), `src/app/activity/useActivity.ts` (add `useBreakdown`), `src/app/App.tsx`, `src/app/shell/Sidebar.tsx`, `src/app/shell/Home.tsx`
- Test: `test/activitySection.test.tsx` (rename to `test/activityPage.test.tsx`), `test/routing.test.tsx`

**Interfaces:**

- Consumes: Task 3 types and route.
- Produces:
  - `useActivityDays(): [ActivityDays, (d: ActivityDays) => void]`, `localStorage` key `"activity-days"`, default 30, safe when storage throws.
  - `useBreakdown(c, days, enabled)`: same query options as `useActivity`, key `["activity-breakdown", c.app, c.env, days, tz]`.
  - `ActivityCards({ data, kind }: { data: Activity; kind: "home" | "page" })`. Home: Contributions, Contributors, New posters, Replied within 24 h. Page: Contributions, Contributors, New members, New posters, Replied within 24 h (with "N unanswered"), Median first reply (`minutes()`, `lowerIsBetter`, "—" and no change when null).
  - Route `/:app/:env/activity` → `ActivityPage`, lazy-loaded in `App.tsx` (its own chunk, `Suspense` fallback a `Skeleton`). Sidebar: `NavLink` "Activity" with lucide `Activity` icon, right under Home, active on `communityPath(c, "activity")`.
  - `ActivityOverview` on Home (replaces `ActivitySection`, still lazy): header "Activity", the dates line with the stored period ("14 Oct – 12 Nov, vs the 30 days before"), a "See all" link to the page at the header's right, the four Home cards. No toggle.
  - `ActivityPage`: `<h1>` "Activity", the period `Tabs` (moved from the section), the dates line, the six cards, then `ActivityPanels` (Task 5 fills the new ones). States as today: SDK line when the probe is off (and no queries), Retry box on error, "No activity in this period" when empty. While the first load runs, the cards show `Skeleton`s of their size and the panels mount in their loading state (Task 5).
- [ ] **Step 1: Write failing tests:** the sidebar shows "Activity" and navigates to `/unchaind/sandbox/activity`; the page shows six cards with the titles above and a 7 d / 30 d / 90 d toggle that stores `"activity-days"`; Home shows four cards, no toggle, and a "See all" link to the page; with the probe off the page shows only "Activity needs the latest community SDK." and no fetch to `activity/breakdown`; median `null` shows "—" with no change line. Reuse the mocks in the current `activitySection.test.tsx`.
- [ ] **Step 2: Run** `npx vitest run test/activityPage.test.tsx test/routing.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run** `npm test`, `npx tsc -b`, `npm run build`. Expected: pass; the build lists a separate Activity page chunk.
- [ ] **Step 5: Commit** the files above: `feat(ui): Activity page, sidebar item, overview on Home`.

### Task 5: The new panels, Bklit topics and loading states

**Files:**

- Install: `npx shadcn@latest add @bklit/heatmap-chart @bklit/ring-chart` (read the installed files before use; don't let the CLI overwrite `index.css` tokens, check the diff)
- Modify: `src/app/activity/ActivityPanels.tsx` (split new panels into `src/app/activity/BreakdownPanels.tsx` if it passes ~250 lines)
- Test: `test/activityPanels.test.tsx`

**Interfaces:**

- Consumes: `Activity` (Task 3), `ActivityBreakdown` via `useBreakdown` (Task 4).
- Produces `ActivityPanels({ data, breakdown, topics }: { data?: Activity; breakdown?: ActivityBreakdown; topics })` laid out on a 12-column grid (stacked under `lg`), in this order and width:
  1. "Posts and comments per day" (8) · **Engagement** (4): three horizontal bars, Members (`membersTotal`), Active members (`activeMembers`), Contributors (`contributors`), each with its count and share of members, one hue (ramp steps, lightest for Members).
  2. "Contributions" table (6) · **Posts per topic** (6): Bklit `BarChart orientation="horizontal"`, sorted desc, slot 1 colour, the category label is `"<topic label>  <count>"` (count via `num`), "(sans)" as "No topic"; tooltip with the same.
  3. **When members are active** (8): Bklit `HeatmapChart`, 7 rows Monday→Sunday × 24 hours, the blue ramp, `HeatmapLegend`, tooltip "Tue 21:00 · 14 posts and comments". "Contributors by posts and comments" (4), today's.
  4. **Languages** (4): Bklit `RingChart` (or `PieChart` if the ring can't show 5 parts), top 4 locales + "Other", locale shown with `Intl.DisplayNames(["en"], { type: "language" })` ("English"), null as "Unknown"; legend rows with label, count and share; colours `--chart-1`…`--chart-5` in fixed order. **Moderation** (4): Reports, AI-hidden, Team actions, each with its count and `change(...)` against `previous`, `lowerIsBetter` for Reports and AI-hidden. **Returning contributors** (4): `returned / previousContributors` as "38 %", "31 of 80 came back"; "—" when `previousContributors` is 0.
  5. **Most engaged posts** (12): five rows: first words (`excerpt`), topic label, author name, likes, comments, date (`periodLabel`-style "8 Nov"). "No posts in this period" when empty.
  - Loading: with `data` / `breakdown` undefined, the area, bar and heatmap charts render with `status="loading"` (Bklit's own hand-off), the other panels a `Skeleton` of their size. Each panel's title stays visible.
- [ ] **Step 1: Write failing tests:** every topic's count is in the document (also for a topic with 1 post next to one with 439); the heatmap gets 7 × 24 cells; the languages legend shows "English" with its count and share and folds the 5th+ locales into "Other"; Moderation shows "▼" with the good tone when reports dropped; returning shows "—" with 0 previous contributors; most engaged posts lists 5 excerpts; with `breakdown` undefined the breakdown panels show skeletons and their titles.
- [ ] **Step 2: Run** `npx vitest run test/activityPanels.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Install and implement.** Check the installed sources for prop names; colours only through tokens.
- [ ] **Step 4: Run** `npm test`, `npx tsc -b`, `npm run build`; report the main chunk and the Activity page chunk sizes (gzip).
- [ ] **Step 5: Commit** the installed chart files by name, `components.json` if changed, and the files above: `feat(ui): Activity breakdown panels, Bklit topics, loading states`.

### Task 6: Roadmap row and spec status (SDK repo)

**Files:**

- Modify: `docs/dashboard-roadmap.md` (brick 5's row: the page, the new numbers, the second function, the indexes), the spec's status line (Amendment 1 approved 2026-11-13)

- [ ] **Step 1:** Edit both; brick 5 stays "in progress".
- [ ] **Step 2: Commit** both files: `docs: roadmap brick 5 row after amendment 1`.
