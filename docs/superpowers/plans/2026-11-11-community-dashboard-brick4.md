# Community dashboard brick 4 (team accounts and composer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team accounts created and edited in Members, and a mail-style composer with shared drafts that publishes as any team account, on the Unchaind community.

**Architecture:** Three PRs in order. (1) `~/Developer/community-sdk`: a core migration adding `post_drafts` and `publish_post_draft()`, an images migration so the nightly sweep keeps draft images, roadmap updates; released as 0.16.0. (2) `~/Developer/unchaind`: SDK bump and `upgrade`, migrations pushed to sandbox (prod by Guillaume). (3) `~/Developer/community-dashboard`: Worker routes (team accounts, handles, drafts, features probe) as tested planners like V1, and the UI (team account form in the member panel, docked composer windows).

**Tech Stack:** Postgres/PL/pgSQL (Supabase), the `@rocapine/community` CLI, Vite 8 + React 19 + TS 6 + Tailwind v4 + shadcn, wouter, TanStack Query, `@supabase/supabase-js` 2 (Worker only), Vitest 4 + happy-dom, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-11-11-community-dashboard-brick4-design.md` (read it first; it carries the validated mockups' path and every decision). V1 spec and plan for the dashboard's conventions: `docs/superpowers/specs/2026-11-10-community-dashboard-v1-design.md`, `docs/superpowers/plans/2026-11-10-community-dashboard-v1.md`.

## Global Constraints

- Backends: scratch `cozfrhmbjrvotpwjnqmu` (agents may change anything), Unchaind sandbox `vjcdpodsrpemanfvrshh` (agents may push migrations and write test data), Unchaind prod `doiafuhoourjtqsmzook`: read-only; Guillaume runs the prod migration, hand him the exact command.
- SDK release (npm publish of 0.16.0) and every merge wait for Guillaume's OK after he tested (memory: verify before merge).
- Dashboard: the browser never sees a Supabase key or URL with a key; every data call is `/api/*`, JSON, `cache-control: no-store`; non-GET requests are JSON (the router's CSRF rule), so uploads are base64 in JSON.
- The actor recorded everywhere (`moderation_actions.actor_email`, `post_drafts.created_by/updated_by`) is the Access email.
- A post has at most one of: image, poll, attachment (SDK rule, `packages/core/src/service.ts:505-516`). Poll: 2 to 4 options. Text: 1 to 2000 characters to publish.
- Pin and notify everyone: only when the author is an admin (`is_admin`); enforced in `publish_post_draft`, mirrored in the UI.
- Name: 2 to 24 characters; bio: at most 300; handle: `^[a-z0-9-]{3,20}$` (same as `supabase/functions/update-profile/index.ts`).
- Name/handle rules: admin team accounts are exempt; non-admin team accounts must pass `containsAppName` / reserved handles (`admin`, `support`, `official`, `team`, `moderator`) from `supabase/functions/_shared/names.ts`, with the community's `name` as the app name.
- A name written by the dashboard is marked checked (`username_checked_at = now()`) and owned (`username_set_by_user = true`); a handle written by it sets `handle_set_by_user = true`.
- UI copy and code in English; UI principles: no page per feature, panels, calm. No hint text under the team account fields (removed on request).
- Every PR: tests, typecheck, lint/prettier green; PR body ends with the Claude Code line; branch per PR, never push to `main`. Dashboard PR: a walkthrough recording (global rule `~/.claude/rules/pr-video.md`).

## Review Focus

1. **Two people on the same draft**: a save with a stale `version` must not overwrite; the composer shows who changed it. → Task 8 (`PUT drafts` 409 test), Task 11 (conflict banner test).
2. **A draft image when the author changes, or the draft is discarded**: the image must end under the publishing author's folder, and a discarded draft's image is left to the sweep (not kept forever). → Task 1 SQL assertions, Task 8 test.
3. **Publishing a draft whose author lost admin since it was written, with Pin or Notify on**: refused with a clear error, nothing published. → Task 1 SQL assertion, Task 11 error-toast test.
4. **A community without the 0.16 migration (prod before Guillaume migrates it)**: composer and "+ New team account" are disabled with the reason; no write is attempted. → Task 5 probe test, Task 9/10 disabled-state tests.
5. **Name or handle edge cases**: emoji-only or accented names for the handle prefill, a handle taken between the check and the save, a non-admin named "Unchaind Team". → Task 6 (`handleFromName`), Task 7 (race and rules tests).

---

## Part 1 — SDK (`~/Developer/community-sdk`, branch `feat/post-drafts`)

### Task 1: `post_drafts` and `publish_post_draft` (core)

**Files:**

- Create: `supabase/migrations/core/014_post_drafts.sql`
- Create: `supabase-tests/post-drafts.sql`

**Interfaces:**

- Produces (used by Tasks 2, 8):
  - table `public.post_drafts(id uuid pk default gen_random_uuid(), author_id uuid null references profiles(id) on delete set null, topic text, content text not null default '' check (char_length(content) <= 2000), image_path text, image_width int, image_height int, poll_options text[], attachment jsonb, notify boolean not null default false, pin boolean not null default false, publish_at timestamptz, version int not null default 1, created_by text not null, updated_by text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`. RLS enabled, no policy, `revoke all … from anon, authenticated`.
  - `public.publish_post_draft(p_draft_id uuid, p_version int, p_actor text) returns uuid` (the new post id), `security definer`, execute granted to `service_role` only.
  - Errors raised (message is the code, `errcode 'P0001'`): `draft_not_found`, `draft_changed`, `not_a_team_account`, `not_admin`, `invalid_content`, `invalid_poll`, `one_extra_only`.
  - `moderation_actions.action` check extended with `publish_post`, `create_team_account`, `update_team_account`.

- [ ] **Step 1: Write `supabase-tests/post-drafts.sql`** in the style of `supabase-tests/pinning.sql` (a `do $$` block ending `raise exception 'POST_DRAFTS_TESTS_PASSED'`). It picks one profile, makes it `is_house = true, is_admin = true`, then asserts:
  - `set local role authenticated; select … from post_drafts` raises `insufficient_privilege`.
  - Publishing a draft `{content 'hello', topic 'general', pin true, notify true}` with version 1 returns an id; that post has `status = 'visible'`, `moderated_at is not null`, `pinned_at is not null`, `broadcast_requested = true`; the draft row is gone; one `moderation_actions` row `publish_post` with `target_post_id` and `target_user_id`.
  - Same with `poll_options = '{a,b,c}'`: three `poll_options` rows, `idx` 0..2.
  - Same with `attachment = '{"type":"verse","id":"43.3.16"}'`: `posts.attachment` equals it.
  - `p_version` 1 on a draft at version 2 → `draft_changed`; unknown id → `draft_not_found`.
  - Author `is_admin = false` with `pin = true` → `not_admin`; author `is_house = false` → `not_a_team_account`; empty content → `invalid_content`; one poll option → `invalid_poll`; poll and attachment together → `one_extra_only`.

- [ ] **Step 2: Run it on scratch to see it fail**

Run: `npx supabase db query --remote=cozfrhmbjrvotpwjnqmu --yes -f supabase-tests/post-drafts.sql`
Expected: an error that `post_drafts` does not exist.

- [ ] **Step 3: Write `core/014_post_drafts.sql`** (header comment like the other core files, `schema v1`, fully idempotent: `create table if not exists`, `create or replace`, `drop constraint if exists`). The function locks the draft `for update`, checks version, author (`is_house`; `is_admin` when `pin or notify`), content length 1..2000, poll 2..4, at most one of image / poll / attachment; inserts the post with `status 'visible'`, `moderated_at now()`, `broadcast_requested = notify`, `pinned_at = case when pin then now() end`, `attachment` and image columns only when set (PL/pgSQL resolves columns at run time, so a backend without images or attachments works as long as the draft has none); inserts `poll_options`; deletes the draft; logs. Re-create the `moderation_actions_action_check` constraint with the three new values added to the existing six.

- [ ] **Step 4: Apply on scratch and run the test**

Run: `npx supabase db query --remote=cozfrhmbjrvotpwjnqmu --yes -f supabase/migrations/core/014_post_drafts.sql && npx supabase db query --remote=cozfrhmbjrvotpwjnqmu --yes -f supabase-tests/post-drafts.sql`
Expected: the second command fails with exactly `POST_DRAFTS_TESTS_PASSED`.

- [ ] **Step 5: Commit** `feat(core): shared post drafts and publish_post_draft for the dashboard`

### Task 2: The image sweep keeps draft images (images)

**Files:**

- Create: `supabase/migrations/images/002_draft_images.sql`
- Modify: `supabase-tests/post-drafts.sql` (add a block)

**Interfaces:**

- Consumes: `post_drafts.image_path` (Task 1). Core always runs before images in `upgrade` (`MODULE_ORDER`).
- Produces: `post_images_unreferenced(int)` with one more `not exists (select 1 from public.post_drafts d where d.image_path = o.name)`; same grants as `images/001_images.sql:95-117`.

- [ ] **Step 1: Add the assertion** to `post-drafts.sql`: insert a `storage.objects` row (`bucket_id 'post-images'`, `name '<uuid>/x.jpg'`, `created_at now() - interval '2 days'`) referenced by a draft; it is absent from `post_images_unreferenced(1000)`; after deleting the draft it is present.
- [ ] **Step 2: Run on scratch** (command of Task 1 Step 4), expect the new assertion to fail.
- [ ] **Step 3: Write `images/002_draft_images.sql`** redefining the function.
- [ ] **Step 4: Apply and run** → exactly `POST_DRAFTS_TESTS_PASSED`.
- [ ] **Step 5: Commit** `feat(images): the nightly sweep keeps images of post drafts`

### Task 3: CLI templates, changeset, docs, PR

**Files:**

- Modify: CLI templates via `node packages/cli/scripts/copy-templates.mjs`; CLI tests that list templates (`packages/cli/src/__tests__/*.test.ts`) if they enumerate them.
- Create: `.changeset/<name>.md` (minor: `@rocapine/community`, core and ui follow the linked group → 0.16.0).
- Modify: `docs/dashboard-roadmap.md`, `docs/superpowers/specs/2026-11-11-community-dashboard-brick4-design.md` (status → approved), this plan (add to the PR).

- [ ] **Step 1:** Run `node packages/cli/scripts/copy-templates.mjs`, then `npm run typecheck && npm test && npx prettier --check .` at the root; fix any template list expectation. Expected: green.
- [ ] **Step 2:** Changeset text: new `core/post_drafts` and `images/draft_images` templates, service-role only, used by the community dashboard; no app change needed.
- [ ] **Step 3:** Roadmap, as listed in the spec's "Roadmap updates" section: replace the "three kinds" decision (lines 42-45) with the 2026-11-11 decision; add the shared-drafts decision; rewrite the brick 4 row (SDK change "yes", status "in progress"); brick 6 row gains "comment and reply as a team account"; brick 7 row says it builds on `post_drafts.publish_at` and `publish_post_draft`; SDK coverage table gains the two templates; "Last reviewed" line → 2026-11-11, SDK 0.16.0. `npx prettier --write docs`.
- [ ] **Step 4:** Commit `chore: release templates, changeset and roadmap for post drafts`; push; open the PR (no recording: nothing visible). Stop for Guillaume's OK; after merge, the release PR / `npm run release` only on his go.

## Part 2 — Unchaind (`~/Developer/unchaind`, branch `chore/community-sdk-0.16`)

### Task 4: Upgrade to 0.16.0 and migrate sandbox

**Files:** `package.json`, `package-lock.json`, `community-sdk.json`, new files under `supabase/migrations/`.

- [ ] **Step 1:** `npm i @rocapine/community-core@0.16.0 @rocapine/community-ui@0.16.0` and `npx @rocapine/community@0.16.0 upgrade`. Expected: two new migration files (`…_community_core_post_drafts.sql`, `…_community_images_draft_images.sql`), `community-sdk.json` lists them.
- [ ] **Step 2:** Push to sandbox: `npx supabase db push --linked` against `vjcdpodsrpemanfvrshh` (as previous upgrades did), then run `supabase-tests/post-drafts.sql` from the SDK repo against sandbox. Expected: `POST_DRAFTS_TESTS_PASSED`.
- [ ] **Step 3:** `npm test` and typecheck green; commit `chore(community): SDK 0.16 — post drafts for the dashboard`; PR (no recording: nothing visible in the app). Hand Guillaume the prod command for after merge: `npx supabase db push --db-url <prod>` or the repo's usual prod push, written out in the PR body.

## Part 3 — Dashboard (`~/Developer/community-dashboard`, branch `feat/brick4-team-composer`)

File map:

```
src/shared/types.ts              + TopicOption, Features, TeamAccount(+Input), Draft(+Fields), ApiErrorCode additions
src/shared/handles.ts            handleFromName (used by Worker and app)
src/worker/communities.ts        topics + attachmentTypes in the registry
src/worker/features.ts           probe: drafts / images / polls / attachments
src/worker/names.ts              containsAppName, isReservedHandle (port of SDK _shared/names.ts)
src/worker/team.ts               team account planners + handlers
src/worker/drafts.ts             draft handlers, image upload, publish
src/worker/router.ts             new routes
src/app/api.ts                   apiPut, apiPatch, apiDelete
src/app/attachments/verse/*      bookNames.ts, bibleRefParser.ts, verseAttachment.ts (ported)
src/app/attachments/types.ts     per-type parse/format registry
src/app/members/TeamAccountForm.tsx
src/app/composer/useComposer.ts  open windows state (context)
src/app/composer/ComposerDock.tsx, ComposerWindow.tsx, DraftsMenu.tsx, fields/*.tsx
src/app/composer/image.ts        browser JPEG re-encode
wrangler.jsonc                   topics for Unchaind prod, sandbox, previews
```

### Task 5: Registry topics and the features probe

**Files:**

- Modify: `src/worker/communities.ts`, `src/shared/types.ts`, `wrangler.jsonc`, `src/worker/router.ts`
- Create: `src/worker/features.ts`, `src/shared/topics.ts`
- Test: `test/communities.test.ts`, `test/features.test.ts`

**Interfaces:**

- Produces:
  - `interface TopicOption { id: string; label: string; adminOnly?: boolean; from?: string; until?: string }` (dates `YYYY-MM-DD`, `until` excluded).
  - `Community` and `PublicCommunity` gain `topics: TopicOption[]` (default `[]`) and `attachmentTypes: string[]` (default `[]`).
  - `interface Features { drafts: boolean; images: boolean; polls: boolean; attachments: boolean }`.
  - `probeFeatures(sb: SupabaseClient): Promise<Features>` — one `select(col).limit(0)` per item (`post_drafts.id`, `posts.image_path`, `poll_options.id`, `posts.attachment`); a "missing relation/column" PostgREST error (codes `42P01`, `42703`, `PGRST204`, `PGRST205`) → false; any other error throws.
  - Route `GET features` → `Features`.
  - `visibleTopics(topics: TopicOption[], isAdmin: boolean, today: string): TopicOption[]` in `src/shared/topics.ts`.

- [ ] **Step 1: Tests.** `parseCommunities` keeps `topics` / `attachmentTypes` and defaults them to `[]`; rejects a topic without `id`. `probeFeatures` with a mock client: all present → all true; `post_drafts` answering `PGRST205` → `drafts: false`; a `500` error → throws. `visibleTopics`: an event topic with `from 2026-11-01, until 2026-12-01` is in on `2026-11-30`, out on `2026-12-01`; `adminOnly` out when `isAdmin` false.
- [ ] **Step 2:** Run `npx vitest run test/communities.test.ts test/features.test.ts` → FAIL.
- [ ] **Step 3:** Implement. In `wrangler.jsonc`, add to the three Unchaind entries (prod, sandbox, previews): `"attachmentTypes": ["verse"]` and the topic list from Unchaind's `COMMUNITY_TOPICS` (`git show origin/main:services/community/communityConfig.ts` in `~/Developer/unchaind`), labels from its `en` locale `community.topics.<id>`, the `no-nut-november` window copied.
- [ ] **Step 4:** Tests PASS; `npm run build` green.
- [ ] **Step 5: Commit** `feat: community topics in the registry and a features probe`

### Task 6: Verse references and handle prefill (pure helpers)

**Files:**

- Create: `src/app/attachments/verse/bookNames.ts`, `bibleRefParser.ts`, `verseAttachment.ts` (ported from `~/Developer/unchaind` `origin/main`: `lib/bookNames.ts`, `lib/bibleRefParser.ts`, `lib/community/verseAttachment.ts`; drop the `logger` import and `@/lib/types` / `@rocapine/community-core` type imports in favour of local types)
- Create: `src/app/attachments/types.ts`, `src/shared/handles.ts`
- Test: `test/verse.test.ts` (port of `__tests__/lib/bibleRefParser.test.ts` and `__tests__/lib/community/verseAttachment.test.ts` plus the cases below), `test/handles.test.ts`

**Interfaces:**

- Produces:
  - `interface AttachmentType { parse(raw: string): { id: string; label: string } | null; format(id: string): string | null }`; `attachmentTypes: Record<string, AttachmentType>` with `verse`.
  - `handleFromName(name: string): string` — accents stripped, lowercase, only `[a-z0-9]`, cut to 20; `""` when nothing is left.

- [ ] **Step 1: Tests.** `attachmentTypes.verse.parse("phil 4:6-7")` → `{ id: "50.4.6-7", label: "Philippians 4:6-7" }`; `parse("Jean 3:16")` → `{ id: "43.3.16", label: "John 3:16" }`; `parse("Psaumes 23")` → null (no verse); `parse("foo 1:1")` → null; `format("43.3.16")` → `"John 3:16"`. `handleFromName("Pastor James")` → `"pastorjames"`; `"Élodie Brûlé"` → `"elodiebrule"`; `"🙏✨"` → `""`; a 30-letter name → 20 chars.
- [ ] **Step 2:** Run `npx vitest run test/verse.test.ts test/handles.test.ts` → FAIL.
- [ ] **Step 3:** Port and implement. Labels are always English (`getBookName(book, "en")`).
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: verse references and handle prefill helpers`

### Task 7: Team accounts in the Worker

**Files:**

- Create: `src/worker/team.ts`, `src/worker/names.ts`
- Modify: `src/worker/router.ts`, `src/shared/types.ts`
- Test: `test/team.test.ts`

**Interfaces:**

- Consumes: `handleFromName` (Task 6), `clientFor`, `runWrites`, `Ctx`, `json` (V1).
- Produces:
  - `interface TeamAccount { id: string; name: string | null; handle: string | null; bio: string | null; avatarUrl: string | null; isAdmin: boolean }`
  - `interface TeamAccountInput { name: string; bio: string | null; isAdmin: boolean; handle?: string; avatarJpegBase64?: string }`
  - `validateTeamInput(i: TeamAccountInput, appName: string): { error: "bad_name" | "bad_bio" | "bad_handle" | "reserved_name" | "reserved_handle" } | null` (pure).
  - Routes: `GET team-accounts` → `TeamAccount[]` (all `is_house`, by name); `POST team-accounts` (create) → `TeamAccount`; `PATCH team-accounts/:id` → `TeamAccount`; `GET handles/:handle` → `{ available: boolean }`. Errors: 400 with the codes above, 409 `handle_taken`, 404 for a non-team id.

- [ ] **Step 1: Tests** (pure + handlers with a mocked client, like `test/members.test.ts`):
  - `validateTeamInput`: name of 1 char → `bad_name`; bio of 301 → `bad_bio`; admin with handle `Ab` → `bad_handle`; non-admin named "Unchaind Team" with appName "Unchaind" → `reserved_name`; admin named "Unchaind" with handle `unchaind` → null; non-admin with a `handle` field → `bad_handle` (only admins choose).
  - Create: calls the auth admin API, then updates `profiles` with `username, bio, is_house true, is_admin, username_set_by_user true` (+ `handle, handle_set_by_user true` for admins), then a second update `username_checked_at` (now), then inserts `moderation_actions` `create_team_account` with `target_user_id`.
  - A unique violation (`23505`) on the handle → 409 `handle_taken`.
  - PATCH on a profile with `is_house false` → 404; PATCH writes `update_team_account`.
  - Avatar: base64 that is not a JPEG (no `FF D8` start) or over 1 MB → 400 `bad_image`; otherwise uploads to `avatars/{id}/{Date.now()}.jpg` and sets `avatar_url` to the public URL.
- [ ] **Step 2:** Run `npx vitest run test/team.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Login-less auth user: first try `sb.auth.admin.createUser({ user_metadata: { team_account: true } })`; if GoTrue refuses a user without email or phone, use `email: team-<uuid>@team.invalid` with `email_confirm: true` and no password. Probe which one works against sandbox once, keep only that path, and write the reason in a one-line comment. `names.ts` is a port of the SDK's `containsAppName` / `isReservedHandle` with the app name as a parameter.
- [ ] **Step 4:** PASS; then on sandbox with `npm run dev`: create one admin and one non-admin account with `curl` through the dev server; check in SQL that the names are checked and the handles as expected.
- [ ] **Step 5: Commit** `feat(worker): create and edit team accounts`

### Task 8: Drafts and publishing in the Worker

**Files:**

- Create: `src/worker/drafts.ts`
- Modify: `src/worker/router.ts`, `src/shared/types.ts`, `src/app/api.ts` (add `apiPut`, `apiPatch`, `apiDelete` sending JSON, same error handling as `apiPost`)
- Test: `test/drafts.test.ts`, `test/api.test.ts`

**Interfaces:**

- Consumes: `post_drafts`, `publish_post_draft` (Task 1), `Features` (Task 5).
- Produces:
  - `interface DraftFields { authorId: string | null; topic: string | null; content: string; image: { path: string; width: number; height: number; url: string } | null; pollOptions: string[] | null; attachment: { type: string; id: string } | null; notify: boolean; pin: boolean }`
  - `interface Draft extends DraftFields { id: string; version: number; createdBy: string; updatedBy: string; updatedAt: string }`
  - Routes: `GET drafts` → `Draft[]` (newest first); `POST drafts` body `DraftFields` → `Draft`; `PUT drafts/:id` body `{ fields: DraftFields; version: number }` → `Draft` or 409 `{ error: "changed", draft: Draft }`; `DELETE drafts/:id` → `{ ok: true }`; `POST drafts/:id/image` body `{ jpegBase64: string; width: number; height: number; version: number }` → `Draft`; `POST drafts/:id/publish` body `{ version: number }` → `{ postId: string }`.
  - Every write route answers 409 `{ error: "drafts_unavailable" }` when `probeFeatures().drafts` is false.

- [ ] **Step 1: Tests:**
  - `PUT` with a stale version → 409 with the current draft; with the right one → `version + 1`, `updated_by` = Access email.
  - `POST …/image` without `authorId` → 400 `no_author`; uploads to `post-images/{authorId}/{uuid}.jpg`, ≤ 2 MB, JPEG magic bytes checked; replacing an image removes the old object.
  - `PUT` that changes `authorId` while an image is set moves the object to the new author's folder (`storage.move`) and updates the path.
  - `publish` maps the function's errors: `draft_changed` → 409 `changed`; `not_admin`, `not_a_team_account`, `invalid_content`, `invalid_poll`, `one_extra_only` → 400 with the same code; `draft_not_found` → 404.
  - `DELETE` removes the draft only (its image is left to the nightly sweep).
  - `api.test.ts`: `apiPut` / `apiDelete` send `content-type: application/json`.
- [ ] **Step 2:** `npx vitest run test/drafts.test.ts test/api.test.ts` → FAIL.
- [ ] **Step 3:** Implement (`rpc("publish_post_draft", { p_draft_id, p_version, p_actor: email })`).
- [ ] **Step 4:** PASS; on sandbox via `npm run dev` + `curl`: create a draft, upload an image, publish; the post shows in the Unchaind sandbox feed.
- [ ] **Step 5: Commit** `feat(worker): shared drafts and publishing`

### Task 9: Team account form in Members

**Files:**

- Create: `src/app/members/TeamAccountForm.tsx`, `src/app/composer/image.ts` (shared with Task 11)
- Modify: `src/app/members/MembersPage.tsx`, `MembersList.tsx`, `MemberPanel.tsx`
- Test: `test/teamAccountForm.test.tsx`, `test/image.test.ts`

**Interfaces:**

- Consumes: Task 7 routes, `handleFromName`, `Features`.
- Produces: `toJpeg(file: Blob, opts: { maxBytes: number; square?: boolean; maxSide: number }): Promise<{ base64: string; width: number; height: number }>` (canvas re-encode, which drops EXIF; quality stepped down until under `maxBytes`). Avatars: `{ maxBytes: 1_000_000, square: true, maxSide: 512 }`. Post images: `{ maxBytes: 2_000_000, maxSide: 2048 }`.
- Produces: URL `members/new` selects the form; the member panel of a team account gets **Edit** and **Write a post as …** (Task 9 renders the button; Task 11 wires it to `openComposer({ authorId })`).

- [ ] **Step 1: Tests:** "+ New team account" switches the filter to Team accounts and opens the form, with a selected "not created yet" row at the top of the list; the handle field is hidden while Admin is off; turning Admin on fills `@pastorjames` from "Pastor James" and stops following the name once edited; availability is checked (debounced) and "taken" disables Create; Create posts the input and selects the new member; the button and form are disabled with "Needs community SDK 0.16" when `features.drafts` is false; no helper text renders under the fields. `toJpeg` returns a JPEG under `maxBytes` (happy-dom canvas stub as the repo already does, or skip-with-reason if it has none: then test the size-stepping loop with an injected encoder).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement with the existing `MemberPanel` layout and shadcn `Input`, `Textarea`, `Switch`, `Button` (mockup `brick4-v2.html` section 1). Edit reuses the form pre-filled; turning Admin on for an account with a suffixed handle shows its current handle.
- [ ] **Step 4:** PASS; `npm run build`; check in the browser pane on sandbox (`npm run dev`), light and dark.
- [ ] **Step 5: Commit** `feat: create and edit team accounts in Members`

### Task 10: Composer dock, windows and drafts menu

**Files:**

- Create: `src/app/composer/useComposer.ts`, `ComposerDock.tsx`, `ComposerWindow.tsx` (shell only: header, minimize/expand/close, body slot), `DraftsMenu.tsx`
- Modify: `src/app/App.tsx` (dock inside `CommunityShell`), `src/app/shell/Sidebar.tsx` ("New post" button with count)
- Test: `test/composerDock.test.tsx`

**Interfaces:**

- Produces: `ComposerContext` with `openComposer(o?: { draftId?: string; authorId?: string }): void`, `windows: { draftId: string; state: "open" | "minimized" | "expanded" }[]`, `close(draftId)`, `minimize(draftId)`, `expand(draftId)`, `restore(draftId)`. At most one window is `open` or `expanded`; opening one minimizes the others. `openComposer()` without a draft creates one (`POST drafts`) first. Windows reset when the community changes.

- [ ] **Step 1: Tests:** "New post" shows the drafts count from `GET drafts`; its menu lists drafts (account · topic, first 60 chars, "you"/other email + relative time) and "Blank post"; key `C` opens a blank post unless focus is in an input/textarea/contenteditable; clicking a minimized strip opens it (no chevron in the strip, only ✕); ✕ closes without `DELETE`; ⤢ renders the window centred over a scrim, Esc returns it to the dock; switching community closes every window; when `features.drafts` is false the button is disabled with its reason.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement (mockups `brick4-team-and-composer.html` section 2, `brick4-v2.html` sections 2 and 3). The dock is fixed bottom-right above the toaster; strips 220px, open window 470px, expanded 640px wide.
- [ ] **Step 4:** PASS; check in the browser pane.
- [ ] **Step 5: Commit** `feat: docked composer windows and the drafts menu`

### Task 11: Composer fields, autosave and publish

**Files:**

- Create: `src/app/composer/fields/AccountPicker.tsx`, `TopicPicker.tsx`, `ImageField.tsx`, `PollField.tsx`, `AttachmentField.tsx`; `src/app/composer/useDraft.ts`
- Modify: `ComposerWindow.tsx`, `src/app/members/MemberPanel.tsx` ("Write a post as …")
- Test: `test/composerFields.test.tsx`, `test/useDraft.test.ts`

**Interfaces:**

- Consumes: Tasks 5-8 (`visibleTopics`, `attachmentTypes`, `toJpeg`, draft routes, `Features`).
- Produces: `useDraft(id)` → `{ draft, update(patch: Partial<DraftFields>), state: "saving" | "saved" | "conflict" | "error", conflict?: Draft, keepMine(), reload(), publish(), discard() }`; saves 800 ms after the last change with the current `version`.

- [ ] **Step 1: Tests:**
  - Autosave: two edits within 800 ms make one `PUT`; footer reads "Saved · edited by you just now".
  - Conflict: a 409 shows "Marie edited this draft 1 min ago" with **Reload** and **Keep mine** (Keep mine re-sends with the server's version).
  - Admin gating: picking a non-admin account hides admin-only topics, unticks and hides Notify and Pin; picking an admin shows them.
  - One extra at a time: adding an image disables Poll and Verse (and each way round), per Global Constraints; extras the community's `Features` lacks are not shown.
  - Verse: typing "phil 4:6-7" shows "Philippians 4:6-7 ✓" and stores `{ type: "verse", id: "50.4.6-7" }`; "foo" shows "Not a reference".
  - Publish: disabled until an account, a topic and 1-2000 characters are set; success closes the window and toasts "Published as Unchaind"; a `not_admin` error toasts "Unchaind is no longer an admin: untick Pin and Notify everyone" and keeps the window.
  - Discard draft: confirmation, then `DELETE` and the window closes.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement (mockup v1 section 2 for the field layout). "Write a post as …" in a team account's panel calls `openComposer({ authorId })`.
- [ ] **Step 4:** PASS; `npm run build && npm run lint`.
- [ ] **Step 5: Commit** `feat: composer fields, autosave and publishing`

### Task 12: End-to-end on sandbox, recording, PR

- [ ] **Step 1:** `npm run dev` against sandbox (`.dev.vars`), in the browser pane: create an admin account "Pastor James" (`@pastorjames`) and a non-admin one; edit one of the existing team accounts; open two drafts, minimize one, expand the other; open the same draft in a second tab, edit both, see the conflict; publish one post each with image, poll and verse, the admin one with Notify and Pin.
- [ ] **Step 2:** On the iOS simulator (Argent, `argent-device-interact` skill; Unchaind dev build on sandbox, Expo launch params from `~/.claude/rules/expo-launch.md`): the three posts are visible, translated, the admin one pinned, the push and inbox row arrived, the verse card opens the reader.
- [ ] **Step 3:** Recording per `~/.claude/rules/pr-video.md`: a walkthrough of the dashboard steps (Argent on the Chromium preview, or the pane) and of the app showing the result; compress with the rule's ffmpeg command.
- [ ] **Step 4:** Push, open the PR (body: what, how tested, the recordings, "prod: features turn on once Guillaume migrates Unchaind prod"). Check the preview deployment on its sandbox community. Stop for Guillaume's test and OK.
- [ ] **Step 5:** After merge: roadmap brick 4 status → done in a small docs PR in `community-sdk`; update memory `community-dashboard-roadmap.md`.
