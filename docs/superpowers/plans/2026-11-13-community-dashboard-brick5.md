# Community dashboard brick 5 (Activity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A corrected `admin_daily_metrics` in the SDK (core/017), and an Activity section on the dashboard's Home with a 7 / 30 / 90-day toggle, stat cards, charts and the contributions breakdown.

**Architecture:** The SQL function does every count (members only, days in the caller's zone) and returns one JSON object per period. The Worker route calls it twice in parallel (the period ending yesterday and the one before) and maps it to camelCase. The Home section renders it with Bklit UI components copied into the repo and restyled through our CSS variables.

**Tech Stack:** Postgres plpgsql (Supabase); Cloudflare Worker; React 19, TanStack Query, Tailwind v4, shadcn/ui, Bklit UI (d3, motion, @number-flow/react); vitest + happy-dom.

**Spec:** [docs/superpowers/specs/2026-11-12-community-dashboard-brick5-design.md](../specs/2026-11-12-community-dashboard-brick5-design.md). Read it with this plan: it holds the definitions, the result shape and the layout.

**Repos:**

- SDK: `/Users/glsx/Developer/community-sdk/.claude/worktrees/dashboard-activity`, branch `feat/dashboard-activity`.
- Dashboard: `/Users/glsx/Developer/community-dashboard/.claude/worktrees/brick5-activity-fe1b44`, branch `claude/brick5-activity-fe1b44`.

## Global Constraints

- SQL runs on the **Unchaind sandbox only**: `supabase db query --linked --project-ref vjcdpodsrpemanfvrshh --yes -f <file>`, **one statement per file**. Production `doiafuhoourjtqsmzook` is read-only: never write to it. Guillaume applies 017 to production. An agent refused a remote command stops and reports.
- Stage files by name only, never `git add -A` (the SDK checkout has untracked files that are not ours). Commit locally; push and open PRs only once Guillaume agrees; never merge.
- A Supabase key never reaches the browser. No refactor of `src/worker/communities.ts`, `src/worker/access.ts` or the registry.
- UI copy in English, no hint text under fields. Calm: no "wow" effects.
- Colour never carries meaning alone: every change has ▲ / ▼ and a sign; every series has a label.
- Members only (`profiles.is_house = false`); posts and comments count unless `deleted`.
- The period ends **yesterday** in the zone; the previous period is the same number of days just before.
- Local dev server on any port except 8799.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A community without the polls or reaction module:** `poll_votes` / `reactions` are `null`; their rows are hidden and the Contributions total adds only what exists (never `NaN`). Test in Task 7.
2. **A previous period with nothing in it** (new community): no "Infinity %"; the change reads "▲ new". Test in Task 5.
3. **Shortly after midnight in the browser's zone:** at 00:30 in Paris (23:30 UTC the day before), the period ends on Paris's yesterday, not UTC's. Test in Task 3.
4. **A garbage `tz` in the query:** falls back to UTC, no 500. Test in Task 3.
5. **No post old enough to be in the reply rate** (`sum(replyEligible) = 0`): the card shows "—" and no change, never "0 %". Test in Task 6.

---

### Task 1: core/017 `admin_daily_metrics` (SDK)

**Files:**

- Create: `supabase/migrations/core/017_activity_metrics.sql`
- Create: `supabase-tests/activity-metrics.sql`
- Create: `.changeset/activity-metrics.md`
- Modify: `packages/cli/src/__tests__/init.test.ts`, `packages/cli/src/__tests__/upgrade.test.ts` (core count 16 → 17, as #80 did for 015)
- Modify: `docs/dashboard-roadmap.md`: brick 5's row only, status "in progress"

**Interfaces:**

- Produces: `public.admin_daily_metrics(from_date date, to_date date, tz text default 'UTC') returns jsonb`, service role only, result exactly as in the spec's "Result" section. Invalid zone: `raise exception 'invalid_time_zone' using errcode = '22023'`, checked against `pg_timezone_names` before reading any row (as 015 checks `p_tz`).

- [ ] **Step 1: Write `supabase-tests/activity-metrics.sql`** in the pattern of `scheduled-posts.sql` (one `do` block, rolls back by raising `ACTIVITY_METRICS_TESTS_PASSED`). It creates its own profiles (two members, one house account) and content at fixed past times, calls the function on a window that contains only its rows (dates in 2001), and asserts:
  - house posts, comments and likes are in no count, topics included;
  - a self-reply doesn't make `replied_24h`; a deleted comment doesn't either; a house account's reply does;
  - a post created under 24 h before `now()` is out of `reply_eligible` and out of `unanswered` (this one uses today, with a window ending today);
  - a member whose first post is deleted and second post is in the window is a new poster on the second post's day, not the first's;
  - a post at `2001-03-10 23:30 UTC` is on `2001-03-11` with `tz => 'Europe/Paris'`, on `2001-03-10` with two arguments;
  - `contributors` / `reactors` / `contribution_buckets` for a member with 1, one with 3 contributions;
  - `poll_votes` and `reactions` are numbers when `to_regclass` finds the tables, `null` otherwise (assert whichever the sandbox has);
  - `admin_daily_metrics('2001-03-10', '2001-03-10', 'Invalid/Zone')` raises with message `invalid_time_zone`.
- [ ] **Step 2: Run it on the sandbox.** Expected: fails (the 3-argument function doesn't exist).
- [ ] **Step 3: Write `017_activity_metrics.sql`.** Header comment as in 015 ("Requires core/004. Idempotent. If #82 lands after this, renumber."). `drop function if exists public.admin_daily_metrics(date, date);` then the plpgsql function, then the `revoke`. Filter on `created_at >= (from_date::timestamp at time zone tz)` and `< ((to_date + 1)::timestamp at time zone tz)`; bucket on `(created_at at time zone tz)::date`. `hidden` keeps its meaning (posts moderated to hidden that day, bucketed in `tz`). Poll votes and reactions through `execute` only when `to_regclass(...)` is not null.
- [ ] **Step 4: Apply on the sandbox**, one statement per file: copy the drop, the create and the revoke into three files in the scratchpad and run them in that order.
- [ ] **Step 5: Run the test.** Expected: error message exactly `ACTIVITY_METRICS_TESTS_PASSED`.
- [ ] **Step 6: Time a 90-day call** on the sandbox (`explain analyze select public.admin_daily_metrics(current_date - 90, current_date - 1, 'Europe/Paris')`). Note the time for the PR. Under ~200 ms is fine; otherwise rework the CTEs before going on.
- [ ] **Step 7: CLI counts and changeset.** Update the two CLI tests (17 core migrations), run `npm test -w packages/cli` (expected: pass). Write the changeset in the style of `.changeset/scheduled-posts.md`: core minor, "the dashboard's Activity numbers", what changed in meaning (house accounts out everywhere, reply rate, new posters, zone), "Migration: no app change. `npx @rocapine/community upgrade`, then `supabase db push`".
- [ ] **Step 8: Roadmap** brick 5 → "in progress". Commit:

```bash
git add supabase/migrations/core/017_activity_metrics.sql supabase-tests/activity-metrics.sql .changeset/activity-metrics.md packages/cli/src/__tests__/init.test.ts packages/cli/src/__tests__/upgrade.test.ts docs/dashboard-roadmap.md
git commit -m "feat(core): admin_daily_metrics for the dashboard's Activity (core/017)"
```

### Shared types (built in Task 3)

Not a task of its own: Task 3 adds them. Listed here so every task uses the same names.

**Interfaces (in `src/shared/types.ts`):**

```ts
export type ActivityDays = 7 | 30 | 90;
export interface DailyActivity {
  day: string;
  posts: number;
  comments: number;
  newPosters: number;
  hidden: number;
  likes: number;
  pollVotes: number | null;
  reactions: number | null;
  replied24h: number;
  replyEligible: number;
  contributors: number;
}
export interface ActivityMetrics {
  daily: DailyActivity[];
  topics: { topic: string | null; count: number }[]; // "(sans)" → null
  replyRate: number;
  unanswered: number;
  contributors: number;
  reactors: number;
  contributionBuckets: Record<"1" | "2-3" | "4-7" | "8+", number>;
}
export interface Activity {
  from: string;
  to: string;
  previous: { from: string; to: string };
  current: ActivityMetrics;
  before: ActivityMetrics;
}
// Features gains: activity: boolean
```

### Task 3: Worker route and probe (dashboard)

**Files:**

- Create: `src/worker/activity.ts`
- Modify: `src/worker/features.ts`, `src/worker/router.ts`, `src/shared/types.ts`
- Test: `test/activity.test.ts` (new), `test/features.test.ts`, `test/router.test.ts`

**Interfaces:**

- Produces:
  - `periodBounds(days: ActivityDays, tz: string, now: Date): { from: string; to: string; previous: { from: string; to: string } }` (dates `YYYY-MM-DD`, built with `zonedParts` and `addDays` from `src/shared/time.ts`).
  - `mapMetrics(raw: unknown): ActivityMetrics`
  - `getActivity(sb: SupabaseClient, days: ActivityDays, tz: string, now?: Date): Promise<Activity>`: two `sb.rpc("admin_daily_metrics", { from_date, to_date, tz })` in `Promise.all`; an RPC error throws.
  - `hasActivity(sb: SupabaseClient): Promise<boolean>` in `features.ts`; `probeFeatures` returns `activity` too.
  - Route `GET /api/c/:app/:env/activity?days=&tz=` → `Activity`; `days` not 7, 30 or 90, or extra path segments → 400 `{ error: "bad_days" }`; `tz` through `safeZone(tz, "UTC")`.

- [ ] **Step 1: Failing tests** in `test/activity.test.ts`, with a fake client `{ rpc: vi.fn(async (_n, args) => ({ data: RAW, error: null })) }`:
  - `periodBounds(30, "Europe/Paris", new Date("2026-11-12T10:00:00Z"))` → `{ from: "2026-10-13", to: "2026-11-11", previous: { from: "2026-09-13", to: "2026-10-12" } }`.
  - Midnight (Review Focus 3): `periodBounds(7, "Europe/Paris", new Date("2026-11-12T23:30:00Z")).to === "2026-11-12"`; with `"UTC"` it is `"2026-11-11"`.
  - `getActivity` calls `rpc` twice with `{ from_date: "2026-10-13", to_date: "2026-11-11", tz: "Europe/Paris" }` and `{ from_date: "2026-09-13", to_date: "2026-10-12", tz: "Europe/Paris" }`, and maps `new_posters` → `newPosters`, `poll_votes: null` → `pollVotes: null`, `replied_24h` → `replied24h`, topic `"(sans)"` → `null`, `contribution_buckets` → `contributionBuckets`.
  - An RPC error rejects.
  - In `test/features.test.ts`: the fake client gains `rpc`; `invalid_time_zone` message → `activity: true`; code `PGRST202` → `false`; any other error throws. "All present" expects `activity: true`.
  - In `test/router.test.ts`: `days=14` → 400 `{ error: "bad_days" }`; `days=30&tz=Not/AZone` (Review Focus 4) reaches the call with `tz: "UTC"`. The router test's `clientFor` mock gains `rpc` returning `RAW` for this.
- [ ] **Step 2: Run** `npx vitest run test/activity.test.ts test/features.test.ts test/router.test.ts`. Expected: FAIL (module not found / missing key).
- [ ] **Step 3: Implement** `activity.ts`, the probe (`sb.rpc("admin_daily_metrics", { from_date: "2001-01-01", to_date: "2001-01-01", tz: "Invalid/Zone" })`) and the route entry `"GET activity"` next to `"GET published"`; the shared types.
- [ ] **Step 4: Run** the three files, then `npm test` and `npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(worker): activity route and probe`, files by name.

### Task 4: Bklit UI and the chart palette (dashboard)

**Files:**

- Modify: `components.json` (`"registries": { "@bklit": "https://bklit.com/r/{name}.json" }`), `src/app/index.css`, `package.json`, `package-lock.json`
- Create: what `npx shadcn add` copies (under `src/components/charts/`, `src/components/ui/card.tsx`, and so on)

**Interfaces:**

- Produces: components `AreaChart`, `BarChart`, `Sparkline`, `Weekends`, the `stat-card-area-01` block, as exported by the copied files (read their exports; later tasks import them from there). Tokens `--chart-1` … `--chart-5`, `--chart-positive`, `--chart-negative`, `--chart-ramp-1` … `--chart-ramp-4`.

- [ ] **Step 1: Baseline.** `npm run build`, note the JS bundle size (gzip) from Vite's output.
- [ ] **Step 2: Add** `npx shadcn add @bklit/area-chart @bklit/bar-chart @bklit/sparkline @bklit/weekends @bklit/stat-card-area-01`. **Do not overwrite** `src/lib/utils.ts` or `src/components/ui/badge.tsx` (answer no; if the CLI overwrote them, `git checkout` them).
- [ ] **Step 3: Tokens** in `src/app/index.css`, replacing whatever the CLI wrote for these names, light / dark:

| Token                           | Light                                                   | Dark                                                    |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| `--chart-1`                     | `oklch(50% 0.13 265)`                                   | `oklch(64% 0.12 265)`                                   |
| `--chart-2`                     | `oklch(70% 0.16 55)`                                    | `oklch(72% 0.15 55)`                                    |
| `--chart-3`                     | `oklch(64% 0.12 195)`                                   | `oklch(76% 0.10 195)`                                   |
| `--chart-4`                     | `oklch(52% 0.12 85)`                                    | `oklch(52% 0.12 85)`                                    |
| `--chart-5`                     | `oklch(46% 0.12 350)`                                   | `oklch(58% 0.12 350)`                                   |
| `--chart-positive`              | `oklch(58% 0.14 150)`                                   | `oklch(70% 0.14 150)`                                   |
| `--chart-negative`              | `var(--destructive)`                                    | `var(--destructive)`                                    |
| `--chart-ramp-1…4` (1 = fewest) | `86% 0.04`, `73% 0.08`, `60% 0.11`, `47% 0.13`, hue 265 | `40% 0.08`, `53% 0.10`, `66% 0.11`, `79% 0.09`, hue 265 |

Bklit's own variables point at ours: `--chart-line-primary: var(--chart-1)`, `--chart-line-secondary: var(--chart-2)`, tooltip background / foreground / muted → `var(--popover)` / `var(--popover-foreground)` / `var(--muted-foreground)`, `--chart-scale-02…05` → the ramp. Register `--color-chart-*` in `@theme inline` like the other tokens.

- [ ] **Step 4: Check** `npx tsc -b`, `npm test`, `npm run build` pass; note the new bundle size (for the PR).
- [ ] **Step 5: Commit** `feat(ui): Bklit charts and the chart palette`.

### Task 5: Format helpers (dashboard)

**Files:**

- Create: `src/app/activity/format.ts`
- Test: `test/activityFormat.test.ts`

**Interfaces:**

- Produces:
  - `change(cur: number, prev: number, unit: "%" | "pts"): { text: string; dir: "up" | "down" | "flat" }`. `%`: `round((cur - prev) / prev × 100)`; `pts`: inputs are rates 0–1, `round((cur - prev) × 100)`. Text `"▲ +8 %"`, `"▼ −3 pts"` (U+2212), `"0 %"` / `"0 pts"` flat. `prev = 0`: `cur > 0` → `"▲ new"` up, `cur = 0` → flat `"0 %"`.
  - `periodLabel(from: string, to: string): string`: `"13 Oct – 11 Nov"`, `"3 – 9 Nov"` in one month.
  - `contributionsOf(d: DailyActivity): number`: posts + comments + likes + (pollVotes ?? 0) + (reactions ?? 0).

- [ ] **Step 1: Failing tests:** `change(108, 100, "%")` → `{ text: "▲ +8 %", dir: "up" }`; `change(97, 100, "%")` → `"▼ −3 %"`; `change(0.68, 0.71, "pts")` → `"▼ −3 pts"`; `change(5, 0, "%")` → `{ text: "▲ new", dir: "up" }` (Review Focus 2); `change(0, 0, "%")` → flat; `periodLabel("2026-10-13", "2026-11-11")` → `"13 Oct – 11 Nov"`; `periodLabel("2026-11-03", "2026-11-09")` → `"3 – 9 Nov"`; `contributionsOf` with `pollVotes: null` adds the rest.
- [ ] **Step 2: Run** `npx vitest run test/activityFormat.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): activity format helpers`.

### Task 6: Activity section, header and stat cards (dashboard)

**Files:**

- Create: `src/app/activity/ActivitySection.tsx`, `src/app/activity/useActivity.ts`
- Modify: `src/app/shell/Home.tsx` (Activity after `ScheduledWeek`, full width, keyed by community like the week)
- Test: `test/activitySection.test.tsx`

**Interfaces:**

- Consumes: `Activity`, `ActivityDays` (Shared types); `change`, `periodLabel`, `contributionsOf` (Task 5); `useFeatures(c).data?.activity`; Bklit stat card and `Sparkline` (Task 4).
- Produces: `useActivity(c: PublicCommunity, days: ActivityDays): UseQueryResult<Activity>`, key `["activity", c.app, c.env, days, browserZone()]`, `placeholderData: keepPreviousData`, `staleTime: 5 * 60_000`, `retry` as in `ScheduledWeek` (no retry on `ApiError`). `ActivitySection()` with the panels slot that Task 7 fills.

- [ ] **Step 1: Failing tests**, harness copied from `test/scheduledWeek.test.tsx` (App mounted on `/unchaind/sandbox`, `browserZone` = Europe/Paris, NOW `2026-11-12T10:00:00Z`, `fetch` answering `/features` with `activity` and `/activity` with a fixture):
  - `activity: false` → the heading "Activity" and "Activity needs the latest community SDK."; no `/activity` request.
  - Loading → a skeleton; a 500 → `role="alert"` with Retry, and Retry refetches.
  - Every number 0 → "No activity in this period".
  - Data → header "13 Oct – 11 Nov, vs the 30 days before"; four cards Contributions, Contributors, New posters, Replied within 24 h with their values; a change shows "▲ +8 %" (text, not colour only); under the rate "12 unanswered" and no change next to it.
  - `sum(replyEligible) = 0` → the rate card shows "—" and no change (Review Focus 5).
  - Clicking "7 d" requests `days=7&tz=Europe%2FParis`, keeps the 30-day numbers on screen until it answers, and is remembered (`localStorage` key `activity-days`) after a remount.
- [ ] **Step 2: Run** `npx vitest run test/activitySection.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Toggle: the existing shadcn `Tabs` (7 d · 30 d · 90 d), default 30, `localStorage` read and write inside `try/catch`. Cards: value, change (`--chart-positive` / `--chart-negative` plus the arrow and sign), sparkline of the daily values (Contributions: `contributionsOf` per day; Contributors: daily `contributors`; New posters: daily `newPosters`; rate: `replied24h / replyEligible`, days with no eligible post left out).
- [ ] **Step 4: Run** the file, then `npm test`. Expected: PASS (the existing Home tests answer `/features` without `activity`, so they see the "needs the latest SDK" line and nothing else changes).
- [ ] **Step 5: Commit** `feat(ui): Activity on Home, header and stat cards`.

### Task 7: Activity panels (dashboard)

**Files:**

- Create: `src/app/activity/ActivityPanels.tsx`
- Modify: `src/app/activity/ActivitySection.tsx` (render the panels)
- Test: `test/activitySection.test.tsx`

**Interfaces:**

- Consumes: `ActivityMetrics`, `contributionsOf`, `change`; Bklit `AreaChart`, `Weekends`, `BarChart`, `Sparkline`; `c.topics` and `topicLabel` from `src/app/shared/format.ts`.
- Produces: `ActivityPanels({ data, topics }: { data: Activity; topics: PublicCommunity["topics"] })`.

- [ ] **Step 1: Failing tests** in `test/activitySection.test.tsx`:
  - Posts and comments per day: a chart labelled with both series names ("Posts", "Comments").
  - Contributions table: rows Posts, Comments, Likes, Poll votes, Reactions with total, per day and change; with `pollVotes: null` on every day the "Poll votes" row is absent and the total equals posts + comments + likes + reactions (Review Focus 1).
  - Posts per topic: sorted by count, label from the community's topic config (fallback `topicLabel`), `null` shown as "No topic".
  - Contributors by contributions: legend "1", "2–3", "4–7", "8+" each with its share in %.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Area chart: posts `--chart-1`, comments `--chart-2`, weekends shaded, crosshair tooltip with the day and both values. Topic bars: one colour (`--chart-1`), "No topic" in `--muted-foreground`, value at the end of each bar. Buckets: one segmented bar, `--chart-ramp-1…4`, 2px surface gaps, no axis. Two panels side by side from `lg`, stacked below.
- [ ] **Step 4: Run** the file, `npm test`, `npx tsc -b`, `npm run build`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(ui): Activity charts and contributions breakdown`.

### Task 8: Run it for real, record, prepare the PRs

- [ ] With 017 on the sandbox: `npm run build && npx wrangler dev --port 8788 --host localhost`, open the Unchaind sandbox Home in light and dark, switch 7 / 30 / 90, compare a few numbers with a direct SQL call (sandbox), check narrow width.
- [ ] Record a Playwright WebKit walkthrough (`recordVideo`; playwright-core 1.58.2 at `~/.npm/_npx/af752b90495482d7/node_modules/playwright-core`): Home → Activity → toggle 7 / 90 → hover the area chart → dark mode. Compress: `ffmpeg -i in.webm -vcodec libx264 -crf 28 -vf scale=1280:-2 -an activity.mp4`.
- [ ] Write both PR bodies (SDK: migration, timing from Task 1, roadmap; dashboard: bundle size before / after from Task 4, `![](./activity.mp4)` alone on its line, attached with `--attach ./activity.mp4`). **Stop for Guillaume's OK before pushing.**
- [ ] After his OK and the PRs: roadmap brick 5 → "done" with the "Shipped:" links, its SDK change → "yes" and the added numbers named; the coverage row for `admin_daily_metrics` notes the rewrite and the release that carries it. Only that row and the coverage table.
