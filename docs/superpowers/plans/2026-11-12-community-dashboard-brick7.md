# Brick 7: Scheduled Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team accounts' drafts can be scheduled from the dashboard composer and go out on their own, with a week calendar on Home and failures shown where the team looks.

**Architecture:** SDK core migration `015_scheduled_posts.sql` adds the schedule columns, `schedule_post_draft`, and a pg_cron job that publishes due drafts through the existing `publish_post_draft`. The dashboard Worker gains a schedule route, a published-posts route and a `scheduling` feature flag. The composer, the New post menu and Home gain the UI. Time conversion lives in one shared module used by the Worker and the app.

**Tech Stack:** Postgres/plpgsql + pg_cron (Supabase), SQL tests run with `supabase db query`; Cloudflare Worker + Vite/React 19/Tailwind v4/shadcn, TanStack Query, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-12-community-dashboard-brick7-design.md` (approved 2026-11-12). Mockups: `.superpowers/brainstorm/53205-1794425101/content/brick7-scheduling.html`.

## Global Constraints

- Repos and branches: community-sdk `feat/scheduled-posts` (has the spec commits); community-dashboard new branch `feat/brick7-scheduled-posts` from `main` (bb3a1fd). Never push or merge without the controller; never touch `main`.
- Backends: scratch `cozfrhmbjrvotpwjnqmu` (free use); Unchaind sandbox `vjcdpodsrpemanfvrshh` (writes allowed with Guillaume's go, run by the controller); Unchaind prod `doiafuhoourjtqsmzook` never.
- SQL commands: `supabase db query --linked --project-ref <ref> --yes -f <file>` (CLI 2.122 has no `--remote`). Agents that are refused a remote command stop and report; they never work around it.
- 014 stays as released-to-sandbox; all brick 7 SQL goes in `supabase/migrations/core/015_scheduled_posts.sql`, idempotent (`if not exists`, `create or replace`, cron scheduling tolerant of "already exists").
- Error codes are raised with errcode P0001 and the code as the message. New codes: `invalid_time`, `missed`.
- Late rule: a due draft more than 30 minutes past `publish_at` is not published; it gets `publish_error = 'missed'`.
- Schedule window: the dashboard allows 2 minutes to 1 year ahead; SQL refuses `publish_at <= now()` or `> now() + interval '1 year 1 day'` with `invalid_time`.
- Time zones: IANA names; `publish_at` is an instant (timestamptz), `publish_tz` is the zone chosen, for display.
- UI copy in English; calm UI; no new page; no hint text except the "your time" line the spec allows. Exact copy: "Schedule this post", "Schedule", "Cancel", "Publish now", "Schedule…", "Change time", "Unschedule", "Schedule again", "Scheduled · n", "Drafts · n", "Nothing scheduled this week", "Didn't go out", "today 19:00"-style times, "Published at 08:00 as scheduled", composer message for `missed`: "It was due more than 30 minutes ago, so it didn't go out", for `invalid_time`: "Pick a time at least 2 minutes from now, within a year".
- Commits: conventional, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tests stay fast and stable in parallel (fake timers, `until`, no real sleeps).

## Review Focus

1. A local time that doesn't exist or exists twice (DST change, e.g. 2026-03-29 02:30 Europe/Paris, 2026-10-25 02:30) must schedule a real instant: the gap moves forward to the first valid minute, the overlap takes the first occurrence. Pinned in Task 5.
2. A post scheduled in another zone near midnight lands on the right day of the Home week (23:30 New York is next day in Paris). Pinned in Task 8.
3. Several due drafts where one fails: the others still go out, and the failed one is recorded. Pinned in Task 2.
4. A teammate edits a scheduled draft in the minute it goes out: the cron publishes the saved version, and the window shows "Published at 08:00 as scheduled". Pinned in Tasks 2 and 6.
5. Scheduling to an event topic outside its window on the chosen date is refused even if the topic is offered today. Pinned in Task 6.

---

## Part 1 — SDK (community-sdk, branch `feat/scheduled-posts`)

### Task 1: Schedule columns and `schedule_post_draft`

**Files:**

- Create: `supabase/migrations/core/015_scheduled_posts.sql`
- Create: `supabase-tests/scheduled-posts.sql` (same shape as `post-drafts.sql`: one `do $$` block that sets up as postgres, asserts, and ends with `raise exception 'SCHEDULED_POSTS_TESTS_PASSED'`)

**Interfaces:**

- Consumes: `post_drafts`, `publish_post_draft(uuid, int, text)` from core/014.
- Produces: columns `post_drafts.scheduled_by text`, `publish_tz text`, `publish_error text`, `failed_at timestamptz`; index `post_drafts_due_idx` on `(publish_at) where publish_at is not null and publish_error is null`; `check_post_draft(d post_drafts) returns void` (raises the publish codes); `schedule_post_draft(p_draft_id uuid, p_version int, p_publish_at timestamptz, p_tz text, p_actor text) returns int` (the new version; service role only); `moderation_actions` action check gains `schedule_post`.

- [ ] **Step 1: Write the failing tests** in `supabase-tests/scheduled-posts.sql`, using a team-account author like `post-drafts.sql` does:
  - scheduling a valid draft one hour ahead returns `version + 1`, sets `publish_at`, `publish_tz = 'Europe/Paris'`, `scheduled_by = 'a@x.co'`, clears `publish_error`/`failed_at`, and logs one `schedule_post` row with `actor_email = 'a@x.co'`;
  - wrong version → `draft_changed`; unknown id → `draft_not_found`;
  - `p_publish_at = now() - interval '1 minute'` → `invalid_time`; `now() + interval '2 years'` → `invalid_time`;
  - an invalid draft (empty content, no image) → `invalid_content`; a non-admin with pin → `not_admin` (same codes as publish);
  - `p_publish_at = null` unschedules: `publish_at`, `publish_tz`, `scheduled_by` null, version bumped, one more `schedule_post` row;
  - rescheduling a draft that has `publish_error = 'missed'` clears the error;
  - `publish_post_draft` still behaves as in 014 (one happy path and `invalid_poll`), now through `check_post_draft`.
- [ ] **Step 2: Run on scratch** — `supabase db query --linked --project-ref cozfrhmbjrvotpwjnqmu --yes -f supabase-tests/scheduled-posts.sql`. Expected: fails (function does not exist).
- [ ] **Step 3: Implement 015.** Move the validation block of `publish_post_draft` (author, banned, admin for pin/notify, content, image, poll, attachment, one extra) into `check_post_draft`, and `create or replace` `publish_post_draft` to call it with the same order of checks and codes. `schedule_post_draft` locks the draft `for update`, checks version (`is distinct from` → `draft_changed`), then for a non-null time runs `check_post_draft` and the time window, writes the four columns plus `version = version + 1`, `updated_by = p_actor`, `updated_at = now()`, inserts the `schedule_post` log (`target_user_id = author_id`), returns the new version. Grants: revoke from public/anon/authenticated, grant execute to service_role on `schedule_post_draft`; `check_post_draft` and (Task 2) `publish_due_post_drafts`: `revoke execute … from public, anon, authenticated` and no grant (functions are executable by `public` by default).
- [ ] **Step 4: Run** the test file on scratch after applying 015 (`… -f supabase/migrations/core/015_scheduled_posts.sql`, then the test). Expected: `SCHEDULED_POSTS_TESTS_PASSED`; `post-drafts.sql` still ends with `POST_DRAFTS_TESTS_PASSED`. Apply 015 twice: no error.
- [ ] **Step 5: Commit** `feat(core): schedule_post_draft and the schedule columns`.

### Task 2: The publishing cron

**Files:**

- Modify: `supabase/migrations/core/015_scheduled_posts.sql`
- Modify: `supabase-tests/scheduled-posts.sql`

**Interfaces:**

- Consumes: Task 1.
- Produces: `publish_due_post_drafts() returns int` (number published; security definer; no grant to API roles); pg_cron job `post-drafts-publish` at `* * * * *` running `select public.publish_due_post_drafts();`.

- [ ] **Step 1: Write the failing tests** (call the function directly as postgres; set `publish_at` by updating rows in the test, since `schedule_post_draft` refuses the past):
  - a draft due 1 minute ago is published (a post exists with its content, the draft is gone, `publish_post` logged with `actor_email = scheduled_by`), and the function returns 1;
  - a draft due in 5 minutes is untouched;
  - three due drafts where the middle one is invalid (non-admin with pin): two posts are created, the invalid draft keeps its `publish_at` and gets `publish_error = 'not_admin'` and `failed_at`;
  - a draft due 31 minutes ago gets `publish_error = 'missed'` and no post; one due 29 minutes ago is published;
  - a second call publishes nothing and changes no failed draft (returns 0);
  - a draft with `publish_error` set and `publish_at` in the past is skipped;
  - the cron job exists: `select 1 from cron.job where jobname = 'post-drafts-publish'`.
- [ ] **Step 2: Run on scratch.** Expected: fails.
- [ ] **Step 3: Implement.** Loop over `select id, version, scheduled_by, publish_at from post_drafts where publish_at <= now() and publish_error is null order by publish_at for update skip locked`; for each, if `publish_at < now() - interval '30 minutes'` set `publish_error = 'missed', failed_at = now()`; otherwise `begin perform publish_post_draft(id, version, scheduled_by); n := n + 1; exception when others then update … set publish_error = sqlerrm, failed_at = now(); end;` (a P0001 code's `sqlerrm` is the code; any other error stores its message truncated to 200 characters). Schedule the job the way `inbox/001_inbox.sql` does (tolerate "already exists").
- [ ] **Step 4: Run** both test files on scratch. Expected: both `…_TESTS_PASSED`. Re-apply 015: no error.
- [ ] **Step 5: Commit** `feat(core): publish scheduled drafts every minute, not past 30 minutes late`.

### Task 3: CLI, changeset, roadmap

**Files:**

- Modify: `packages/cli/src/__tests__/init.test.ts:43` (`toHaveLength(15)` → 16), `packages/cli/src/__tests__/upgrade.test.ts:132,143` (15 → 16, 16 → 17)
- Create: `.changeset/scheduled-posts.md` (minor for `@rocapine/community-core`, `@rocapine/community-ui`, `@rocapine/community`; text in the style of `post-drafts.md`: one new migration template, nothing changes in the app)
- Modify: `docs/dashboard-roadmap.md`: brick 4 status `done` with "Shipped: dashboard#3, sdk#78 (SDK 0.16)"; brick 7 `in progress`; the SDK coverage table gains a row "Scheduled posts (core `015`) | 0.16 | Composer, Home | 7"; "Last reviewed: 2026-11-12, SDK 0.16.0."

- [ ] **Step 1:** `npm run build -w packages/cli` (prebuild copies templates), then `npm test` at the root. Expected before the count edits: the two count assertions fail; after: all pass (53 CLI + core/ui).
- [ ] **Step 2:** `npx prettier --check .` passes (the CI runs it; the roadmap table must stay aligned — run `npx prettier --write docs/dashboard-roadmap.md`).
- [ ] **Step 3: Commit** `chore: brick 7 changeset, CLI counts and roadmap`.

Controller after Part 1: with Guillaume's go, apply 015 to the Unchaind sandbox and run both SQL test files there; open the SDK PR (no recording: nothing visible in an app).

## Part 2 — Dashboard (community-dashboard, branch `feat/brick7-scheduled-posts`)

### Task 4: Worker — scheduling data and routes

**Files:**

- Modify: `src/shared/types.ts` (`Features.scheduling: boolean`; `Draft` gains `publishAt: string | null`, `publishTz: string | null`, `scheduledBy: string | null`, `publishError: string | null`, `failedAt: string | null`; new `PublishedPost { id: string; authorId: string; excerpt: string; createdAt: string; kind: "image" | "poll" | "verse" | null }`)
- Modify: `src/worker/features.ts` (`scheduling = has(sb, "post_drafts", "scheduled_by")`)
- Modify: `src/worker/drafts.ts` (draft reads use `select("*")` so a backend without 015 still lists drafts; `toDraft` maps each new field with `?? null`; `scheduleDraft`; `"invalid_time"` in the passed-through codes)
- Modify: `src/worker/router.ts` (`POST drafts/:id/schedule`, `GET published`)
- Test: `test/drafts.test.ts`, `test/features.test.ts`, `test/router.test.ts`

**Interfaces:**

- Produces: `scheduleDraft(sb, id, body: { version: number; publishAt: string | null; timeZone: string | null }, email): Promise<Draft | Fail>` — rpc `schedule_post_draft`, then re-reads the row; P0001 `draft_changed` → 409 `{error:"changed", draft}` like a save; other publish codes and `invalid_time` → 400 with the code; `draft_not_found` → 404. Route body validation: `publishAt` null or an ISO instant (`!isNaN(Date.parse)`), `timeZone` required with a time and accepted by `new Intl.DateTimeFormat("en", { timeZone })`, else 400 `bad_body`. The route also refuses an attachment type the community lacks (`attachmentError`) and a module the community lacks (`module_missing`, same probe as publish).
- Produces: `listPublished(sb, from: string, to: string): Promise<PublishedPost[]>` — posts by `is_house` authors with `created_at` in [from, to), visible, newest last, max 200; `excerpt` = first 60 characters; `kind` from image_path / poll / attachment. Route `GET published?from=<iso>&to=<iso>` (both required, range ≤ 8 days, else 400).

- [ ] **Step 1: Failing tests:** probe reports `scheduling`; `toDraft` maps the five fields; `scheduleDraft` passes `p_draft_id, p_version, p_publish_at, p_tz, p_actor` and returns the re-read draft; 409 with the current draft on `draft_changed`; 400 `invalid_time`; 400 `bad_body` for an unknown zone; `GET published` validates the range and maps rows (one with a poll → `kind: "poll"`).
- [ ] **Step 2:** `npx vitest run test/drafts.test.ts test/features.test.ts test/router.test.ts` — fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command passes; `npm test` green.
- [ ] **Step 5: Commit** `feat(worker): schedule drafts and list the team's published posts`.

### Task 5: Shared time helpers

**Files:**

- Create: `src/shared/time.ts`
- Test: `test/time.test.ts`

**Interfaces (Produces):**

- `zonedToInstant(date: string /* YYYY-MM-DD */, time: string /* HH:MM */, tz: string): string` — ISO instant. A local time in a DST gap moves forward to the first valid minute; in an overlap, the first occurrence.
- `zonedParts(iso: string, tz: string): { date: string; time: string; weekday: string }` (weekday `Mon`…`Sun`).
- `formatWhen(iso: string, tz: string, browserTz: string, now: Date): string` — "today 19:00", "tomorrow 08:00", "Thu 08:00" within 6 days ahead, else "Thu 13 Nov, 08:00"; past dates "Wed 08:00" / "Wed 12 Nov, 08:00"; when `tz !== browserTz`, appends the zone's city ("08:00 New York").
- `zoneLabel(tz: string, at: Date): string` — "New York · UTC−5", "Paris · UTC+1", "UTC".
- `zoneOptions(browserTz: string, lastUsed: string | null): string[]` — lastUsed (if valid) then browserTz, then `COMMON_ZONES` = Europe/Paris, Europe/London, America/New_York, America/Chicago, America/Los_Angeles, America/Sao_Paulo, UTC, then the rest of `Intl.supportedValuesOf("timeZone")`, no duplicates.
- `quickPicks(now: Date, tz: string): { label: string; date: string; time: string }[]` — "Tomorrow 08:00", "Tomorrow 19:00", "Mon 17 Nov 08:00" (the next Monday after tomorrow), in `tz`.
- `weekStart(date: string): string` — the Monday on or before `date`.

- [ ] **Step 1: Failing tests** with exact values:
  - `zonedToInstant("2026-11-13", "08:00", "Europe/Paris") === "2026-11-13T07:00:00.000Z"`; `("2026-07-01","08:00","America/New_York") === "2026-07-01T12:00:00.000Z"`;
  - gap: `("2026-03-29","02:30","Europe/Paris") === "2026-03-29T01:00:00.000Z"` (03:00 local); overlap: `("2026-10-25","02:30","Europe/Paris") === "2026-10-25T00:30:00.000Z"`;
  - round trip: `zonedParts(zonedToInstant(d,t,z), z)` gives back `d`,`t` for non-DST inputs;
  - `formatWhen("2026-11-12T18:00:00Z","Europe/Paris","Europe/Paris", new Date("2026-11-12T10:00:00Z")) === "today 19:00"`; a New York post shown to Paris: `"Thu 08:00 New York"`;
  - `zoneLabel("America/New_York", new Date("2026-11-12")) === "New York · UTC−5"` (true minus sign);
  - `zoneOptions("Europe/Paris", "Asia/Tokyo")[0..1]` = Tokyo, Paris; no duplicates; an invalid lastUsed is ignored;
  - `weekStart("2026-11-16") === "2026-11-16"`, `weekStart("2026-11-15") === "2026-11-09"`.
- [ ] **Step 2:** `npx vitest run test/time.test.ts` — fails.
- [ ] **Step 3:** Implement with `Intl.DateTimeFormat(…, { timeZone, hourCycle: "h23" }).formatToParts` (offset by comparing the zone's wall time to UTC; iterate once more for DST). No date library.
- [ ] **Step 4:** Passes; `npm test` green.
- [ ] **Step 5: Commit** `feat(shared): time zone helpers for scheduling`.

### Task 6: Composer — schedule, banners, messages

**Files:**

- Create: `src/app/composer/SchedulePopover.tsx`
- Modify: `src/app/composer/ComposerWindow.tsx` (split button, banners, ERRORS `missed` / `invalid_time`, deleted message), `src/app/composer/useDraft.ts` (`schedule`, `unschedule`)
- Test: `test/composerFields.test.tsx` (or a new `test/composerSchedule.test.tsx`), `test/useDraft.test.ts`

**Interfaces:**

- Consumes: Task 4 route and `Draft` fields; Task 5 helpers; `visibleTopics`.
- Produces: `useDraft(id).schedule(publishAt: string, timeZone: string): Promise<boolean>` and `.unschedule(): Promise<boolean>` — flush pending edits first (like publish), POST the schedule route with the current version, then store the returned draft as both `cur` and `saved`; a 409 shows the conflict banner; other errors throw `ApiError`. The localStorage key `composer.scheduleZone` (wrapped in try/catch) remembers the last zone used.

- [ ] **Step 1: Failing tests:**
  - with `scheduling: true`, the footer has "Publish" and a "▾" button; the menu lists "Publish now" and "Schedule…"; with `scheduling: false`, "Schedule…" is disabled and the reason "Needs community SDK 0.16" is its description;
  - "Schedule…" opens "Schedule this post" with date, time and zone (the browser zone selected, or the last one used); a quick pick fills date and time; a zone that isn't the browser's shows one line "14:00 your time"; no other hint text (`not.toMatch(/within a minute/)`);
  - Schedule posts `{version, publishAt: "2026-11-13T07:00:00.000Z", timeZone: "Europe/Paris"}`, closes the window, toasts "Scheduled for Thu 13 Nov, 08:00";
  - Schedule is disabled for a time under 2 minutes ahead or over a year, and when Publish would be disabled; an event topic whose `until` is before the chosen date shows the stale-topic notice and disables Schedule even though the topic is offered today;
  - a scheduled draft reopened shows "Scheduled for Thu 13 Nov, 08:00 · by marie" with "Change" and "Unschedule"; the main button reads "Publish now" and its ▾ menu offers "Change time" and "Unschedule"; Unschedule posts `publishAt: null`;
  - a failed draft shows "Didn't go out at Wed 12 Nov, 08:00: It was due more than 30 minutes ago, so it didn't go out" with "Schedule again" and "Publish now";
  - a scheduled draft whose `publishAt` is past and that leaves the list shows "Published at 08:00 as scheduled" (not "by someone else");
  - 400 `invalid_time` toasts "Pick a time at least 2 minutes from now, within a year".
- [ ] **Step 2:** Run the composer tests — fail.
- [ ] **Step 3:** Implement. The split button: shadcn `DropdownMenu` on the ▾ part; the popover: a small absolutely positioned panel (or shadcn `Dialog` styled as popover if focus trapping is simpler — focus moves into it and returns to ▾ on close; Escape closes it only). Native `input type="date"` / `type="time"`, a native `select` for the zone.
- [ ] **Step 4:** Passes; full `npm test` green and stable (run it 3 times).
- [ ] **Step 5: Commit** `feat(composer): schedule a post, scheduled and failed states`.

### Task 7: New post menu — drafts and scheduled

**Files:**

- Modify: `src/app/composer/DraftsMenu.tsx`
- Test: `test/composerDock.test.tsx`

- [ ] **Step 1: Failing tests:** the badge and the one-click rule count only drafts without `publishAt`; the menu (rather than one click) shows when there is a draft or a scheduled post; sections "Drafts · n" (with "Blank post") and "Scheduled · m"; scheduled sorted failed first then by `publishAt`; each shows `formatWhen` ("today 19:00") or "didn't go out"; picking one opens it in a window.
- [ ] **Step 2:** fails. **Step 3:** implement. **Step 4:** passes, `npm test` green.
- [ ] **Step 5: Commit** `feat(composer): the New post menu lists scheduled posts`.

### Task 8: Home — the week

**Files:**

- Create: `src/app/shell/ScheduledWeek.tsx`
- Modify: `src/app/shell/Home.tsx`
- Test: `test/scheduledWeek.test.tsx`

**Interfaces:** Consumes `useDrafts` (scheduled and failed drafts), `GET published?from&to` (via TanStack Query key `["published", app, env, from]`), Task 5 helpers.

- [ ] **Step 1: Failing tests:**
  - "Scheduled · n" counts the scheduled drafts of the shown week; days Monday–Sunday in the browser zone with today marked; ‹ › change week; a click on the range label returns to this week;
  - a draft at 23:30 America/New_York on Wed 12 Nov appears on Thu 13 in a Europe/Paris browser, labelled "05:30 · 23:30 New York";
  - past days list published posts muted with "published"; empty week shows "Nothing scheduled this week";
  - each failed draft shows a red line "Didn't go out: “<first words>” (<when>) — <reason>" with "Open"; Open and a card click open the composer on that draft;
  - without `scheduling`, the section is not shown.
- [ ] **Step 2:** fails. **Step 3:** implement (7-column grid, cards with time, account, first words and 📊/📖/🖼). **Step 4:** passes, `npm test`, `npm run lint`, `npm run build` green.
- [ ] **Step 5: Commit** `feat(home): the week of scheduled and published posts`.

### Task 9: End to end, recording, PRs (controller)

- [ ] With 015 on the Unchaind sandbox: run the dashboard locally (`npm run build && npx wrangler dev --port 8799 --host localhost`), schedule a post 3 minutes ahead in Europe/Paris and one in America/New_York, watch the first go out (the feed, the log `publish_post` with your email as actor, the Home week updating), unschedule the second; make one fail (Pin on a non-admin account set directly in SQL) and see it on Home, in the menu and in the composer.
- [ ] Record the walkthrough with Playwright WebKit (`recordVideo`), compress, open the dashboard PR with it and the SDK PR; stop for Guillaume's test and OK.

## Part 3 — Release (after both PRs merge, Guillaume)

- [ ] `changeset version` on `release/0.16.0` (both changesets → 0.16.0), release PR, Guillaume merges and runs `npm run release`.
- [ ] Unchaind: in `~/Developer/unchaind/.claude/worktrees/sdk-0.16` (branch `chore/community-sdk-0.16`, rebase on `origin/main`), `npx @rocapine/community@0.16.0 upgrade` adds `015`, bump `@rocapine/community-*` to `^0.16.0`, tests, push, PR. Sandbox history: `migration repair --status applied` for the three timestamps (or `db push`). Prod: Guillaume's `db push` after merge.
- [ ] Roadmap: brick 7 `done` with its PRs; memory updated.
