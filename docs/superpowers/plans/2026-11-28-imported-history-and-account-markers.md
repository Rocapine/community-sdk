# Imported history, account markers, surviving bans and dashboard brick 23 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activity counts imported history, merged and deleted-account profiles are marked, a ban survives account deletion, and the dashboard shows all of it on the member card.

**Architecture:** Two SDK migrations — `core/021` adds the two marker columns to `profiles` and redefines the two admin metric functions; `accounts/003` sets the markers from the account functions (never from `merge_profiles`) and adds `account_bans` — tested with the repo's SQL test files against the Unchaind sandbox. Then the dashboard (separate repo) reads the markers and `account_links` behind probes.

**Tech Stack:** Postgres (Supabase), plpgsql; SQL test files in `supabase-tests/` (assert + rollback by raise); Deno edge-function tests; Cloudflare Worker + React dashboard with vitest.

**Spec:** /Users/glsx/Developer/community-sdk/.claude/worktrees/accounts-markers/docs/superpowers/specs/2026-11-28-imported-history-and-account-markers-design.md

**Repos and branches:** SDK tasks in `/Users/glsx/Developer/community-sdk/.claude/worktrees/accounts-markers` (branch `feat/accounts-markers`, from origin/main edb54c8; the main checkout is someone else's messaging branch — never touch it). Dashboard task in `/Users/glsx/Developer/community-dashboard` on a new branch `feat/brick23-accounts` from main.

## Global Constraints

- Never redefine `merge_profiles` (the messaging branch does, in its `accounts/003_merge_hooks.sql`, which will be renumbered `004`).
- Migration headers follow the existing style (`-- community-sdk <module>/<file> (schema v1)`, what it changes, "Fully idempotent."); every migration is idempotent (`if not exists`, `create or replace`, guarded `alter`).
- `merged_into` and `account_deleted_at` are not client-writable (same treatment as `is_placeholder`: no grant to authenticated).
- A ban key is never the subject in clear: `account_bans.subject_hash = encode(sha256(convert_to(provider || ':' || subject, 'UTF8')), 'hex')` (Postgres's built-in sha256, no pgcrypto) (computed in SQL; ruling: the session hash in `account_session_calls` is computed in TypeScript and can't be reused from SQL).
- Placeholders join on their first contribution: join date = earliest of their posts' and comments' `created_at`, else their own `created_at`.
- Merged profiles (`merged_into is not null`) are left out of every metric and every dashboard list, search and count; deleted-account profiles count as members until `account_deleted_at` and their content always counts.
- Dashboard copy (exact): chip "Deleted account"; filter label "Deleted accounts"; card notice "This member deleted their account. Their posts stay."; card line label "App account"; merged item view "Merged into <name>".
- No agent writes to production. The Unchaind sandbox (`vjcdpodsrpemanfvrshh`) may receive these migrations and the SQL test runs (which always roll back).
- SDK tests: `npm test` at the repo root; SQL tests run with the Supabase MCP `execute_sql` (or `npx supabase db query`) against the sandbox and pass when the raised message is the file's `*_TESTS_PASSED` string. Dashboard: `npx vitest run --exclude '.claude/**'`, `npx tsc -p tsconfig.worker.json --noEmit`, `npm run build`, `npm run lint`.

## Review Focus

1. A placeholder that only liked or voted (no post, no comment) — joins on its own `created_at`, its likes count. Test in Task 1.
2. A profile merged into one whose account is later deleted — the merged row stays out of every count, the target counts until deletion. Test in Task 1.
3. A banned account deleted, then unbanned from the dashboard, then linked again — comes back unbanned. Test in Task 2 (SQL) and Task 3 (Worker calls `account_unban`).
4. An app without the accounts module (or a schema before core 021) — the dashboard behaves as today, no 500. Test in Task 3.
5. Search for a merged profile's name or handle — not returned; opening its URL directly says "Merged into <name>". Test in Task 3.

---

### Task 1: SDK core 021 — markers columns and metrics that count imported history

**Files:**

- Create: `supabase/migrations/core/021_imported_history.sql`
- Modify: `supabase-tests/placeholders.sql` (its expectations flip: placeholders now count) and add the marker cases; keep `supabase-tests/activity-metrics.sql` and `activity-breakdown.sql` passing
- Create: `.changeset/imported-history.md` (package `@rocapine/community`, the CLI that ships migrations — copy the shape of the poll-limits release changeset in git history: `git log --all -- .changeset`)

**Interfaces:**

- Produces: `profiles.merged_into uuid null references profiles(id) on delete set null`, `profiles.account_deleted_at timestamptz null`; `admin_daily_metrics(...)` and `admin_activity_breakdown(...)` with the same signatures and JSON shapes as core 017/019.

- [ ] **Step 1: Rewrite `supabase-tests/placeholders.sql` expectations, failing.** Keep its setup (two profiles, one placeholder) and assert, with the same `daily`/totals keys: a placeholder's post and comment count (`posts` = 2 for the day with both posts, `comments` = 1); the placeholder is a contributor; it is a new member on the day of its first post (not on its `created_at`, set 30 days later in the test); `members_total` includes it from that day. Add: a placeholder with only a like joins on its `created_at` and its like counts (Review Focus 1); a profile with `merged_into` set is in no count (`members_total`, `new_members`, `contributors`, `active_members`) and its content (if any remained) doesn't exist by construction; a profile with `account_deleted_at` inside the window counts in `members_total` for days before the deletion only, and its posts count (Review Focus 2 with a merged row pointing to it). Raise `PLACEHOLDERS_TESTS_PASSED` at the end.
- [ ] **Step 2: Run it on the sandbox** → fails (019 excludes placeholders; columns missing).
- [ ] **Step 3: Write `core/021_imported_history.sql`.** Add the two columns (idempotent), no grants to authenticated. Redefine both functions from their core 019 bodies with: author/actor filters `not a.is_house and a.merged_into is null` (placeholders included); a `joined` per profile = `case when is_placeholder then coalesce(least(min post created_at, min comment created_at), created_at) else created_at end`, used for new members, members total and returning contributors; members total and new members also require `merged_into is null` and (`account_deleted_at is null or account_deleted_at >= <period end>` for the total). Keep `security definer`, grants and comments as in 019.
- [ ] **Step 4: Apply to the sandbox and run** `placeholders.sql`, `activity-metrics.sql`, `activity-breakdown.sql` → each raises its `*_TESTS_PASSED`.
- [ ] **Step 5:** `npm test` at the root still passes (CLI tests list migrations); add the changeset. Commit `feat(core): imported history counts in Activity; markers for merged and deleted profiles` (stage by name).

### Task 2: SDK accounts 003 — set the markers, bans that survive deletion

**Files:**

- Create: `supabase/migrations/accounts/003_markers_and_bans.sql`
- Modify: `supabase-tests/accounts.sql` (new cases at the end, before the final raise)
- Create: `.changeset/account-markers.md`
- Modify: `docs/dashboard-roadmap.md` (coverage rows for core 021 / accounts 003; the two "SDK improvements" rows and the "Count placeholders' content" row → `shipped`; brick 23 → `in progress`), and the accounts module docs if they list functions (`grep -rn account_delete_profile docs packages --include=*.md`)

**Interfaces:**

- Consumes: the Task 1 columns.
- Produces: table `account_bans (provider text, subject_hash text, banned_at timestamptz default now(), primary key (provider, subject_hash))`, service role only; `account_link_and_merge(p_provider, p_subject, p_main, p_merge)` sets `merged_into = p_main` on each merged id and bans `p_main` when its (provider, subject hash) is in `account_bans`; `account_delete_profile(p_profile)` sets `account_deleted_at = now()` and, when the profile is banned, inserts the hash of each of its `account_links` rows (the edge function calls it before it deletes the link — `supabase/functions/_shared/account-session.ts:300-305`); new `account_unban(p_profile uuid) returns void` (service role) deleting the `account_bans` rows of the profile's links.

- [ ] **Step 1: Failing cases in `supabase-tests/accounts.sql`:** after a merge through `account_link_and_merge`, the merged profile's `merged_into` = main; `account_delete_profile` sets `account_deleted_at`; deleting a banned linked profile stores the sha256 hash (assert no row contains the subject in clear); linking the same (provider, subject) to a fresh profile bans it and writes one `moderation_actions` row (`action = 'ban'` if the check constraint allows it — read the latest constraint in core 015/014 — with `actor_email = 'account ban'`, note `'banned account came back'`); after `account_unban(profile)` the hash row is gone and a new link is not banned (Review Focus 3).
- [ ] **Step 2: Run on the sandbox** → fails.
- [ ] **Step 3: Write `accounts/003_markers_and_bans.sql`** redefining `account_link_and_merge` and `account_delete_profile` from their accounts 001/002 bodies (unchanged otherwise), creating `account_bans` (RLS on, revoke from public/anon/authenticated) and `account_unban`. Profile updates use the module's existing trusted-write mechanism (`set_config('community.trusted', 'on', true)` as in 002).
- [ ] **Step 4: Apply to the sandbox, run `accounts.sql`** → `ACCOUNTS_TESTS_PASSED`; `npm test` passes; the Deno tests in `supabase/functions/_shared/*_test.ts` still pass if Deno is available (no TS change expected).
- [ ] **Step 5:** changeset + roadmap/docs edits. Commit `feat(accounts): merged and deleted profiles are marked; a ban survives account deletion`.

### Task 3: Dashboard brick 23 — accounts on the member card

**Files (dashboard repo):** `src/worker/features.ts` (probes), `src/worker/members.ts`, `src/worker/queue.ts` (author summary), `src/worker/router.ts` (unban → `account_unban`, new filter), `src/shared/types.ts`, `src/app/members/MembersList.tsx`, `src/app/members/MemberPanel.tsx`, `src/app/shared/AuthorSummary.tsx`; tests next to them.

**Interfaces:**

- Consumes: `profiles.merged_into`, `profiles.account_deleted_at`, `account_links (provider, subject, profile_id, linked_at)`, `rpc("account_unban", { p_profile })`.
- Produces: `MemberRow.isDeletedAccount: boolean`; `Member.appAccount: { provider: string; subject: string; linkedAt: string } | null`; `Member.mergedInto: { id: string; name: string | null } | null`; `AuthorSummary.isDeletedAccount`; `MemberFilter` gains `"deleted"`.

- [ ] **Step 1: Failing tests:** lists, search and every filter exclude `merged_into is not null`; the "deleted" filter lists `account_deleted_at is not null`; the chip "Deleted account" in Members, panel and queue author summary; the card notice (exact copy); the "App account" line with provider, copyable subject and "linked since"; opening a merged profile shows "Merged into <name>" linking to it (Review Focus 5); Unban calls `account_unban` when the accounts module is installed and not otherwise; on a schema without the columns or `account_links`, everything behaves as before with no 500 (Review Focus 4).
- [ ] **Step 2:** run → fail. **Step 3:** implement with probes (`has(sb, "profiles", "merged_into")`, `has(sb, "account_links", "profile_id")`, cached per request like the existing probes). **Step 4:** full suite, tsc, build, lint pass. Read-only check against the sandbox through local `wrangler dev` (local D1 at `/private/tmp/claude-501/-Users-glsx-Developer-community-sdk/6902835c-f9d2-4b2e-9bcc-343f60d2f1d5/scratchpad/cleanup/state`), GET only.
- [ ] **Step 5:** Commit `feat: accounts on the member card (brick 23)`.
