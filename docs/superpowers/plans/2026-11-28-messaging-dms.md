# Messaging, part 2: direct messages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Direct messages between two members on the part-1 chat core: opt-out per member, entry points, message requests with silent decline and cooldown, neutral request pushes, read receipts, account requirement, and the DM side of the Messages page and header.

**Architecture:** A new migration module `dms` (implies `messaging`) adds the DM tables, settings keys and RPCs, and replaces the few messaging functions DMs change (`send_message`, `can_read_conversation`, the messages read policy, `unread_followed_messages*`, `messaging_on_account_delete`, `merge_messaging`), each starting from its latest body. A DM is a `conversations` row of kind `dm` with exactly two `conversation_members` rows; the recipient's row carries the request state and a `visible_from` timestamp that hides what a declined request contained. `list_conversations` stays as groups/003 left it; DM-specific data comes from new RPCs (`dm_peers`, `list_dm_requests`, `dm_peer_read`). Pushes reuse `notify-message`.

**Tech Stack:** as part 1 (Supabase SQL/RLS/RPC, Realtime, Deno Edge Functions, TypeScript, TanStack Query v5, React Native + web, Vitest, CLI, changesets).

**Spec:** `docs/superpowers/specs/2026-11-27-messaging-design.md` (sections Config › `DmsConfig`, Data model › `dms`, Behaviour › DMs, Notifications and push, Blocking, Account deletion, Profile merge). Part 1 plan and ledger: `docs/superpowers/plans/2026-11-27-messaging-core-groups.md`, `.superpowers/sdd/2026-11-27-messaging-core-groups/progress.md` (rulings R1–R20 still hold). Validated mockup: Unchaind repo `docs/superpowers/specs/messaging-mockups/dm-requests.html` option B (list, then the conversation with Accept / Decline / Block-and-report bar and the sender's context).

## Global Constraints

- Branch `feat/messaging-dms`, stacked on `feat/messaging-groups` (PR #120). Same release line: the changeset adds to 0.22.0 if both ship together, else bumps minor.
- `modules.dms?: Partial<DmsConfig> | false`; defaults: `firstMessage: "direct"`, `entryPoints: ["profile"]` (values `"profile" | "newMessage" | "contextMenu"`), `readReceipts: false`, `requireAccount: false`, `requestsPerDay: 5`, `declineCooldownDays: 30`. `messagingSettings(cfg)` is non-null when groups OR dms is on.
- Backend settings keys added to `messaging_settings` (seeded, validated by `messaging_set_settings`, returned by `messaging_client_settings`, compared by schema-check): `dmsFirstMessage` ("direct"|"requests"), `dmsReadReceipts` (bool), `dmsRequireAccount` (bool), `dmsRequestsPerDay` (int ≥ 1), `dmsDeclineCooldownDays` (int ≥ 0).
- Privacy anti-goals (spec): a DM is readable only by its two members, except an app admin through `admin_message_context` on a reported or AI-hidden message; a blocked pair can never reach each other; a request never tells its sender it was read; a request push names no one and quotes nothing, whatever `pushPreview` says; a declined request's messages are never shown to the recipient again.
- Account rule on the server when `dmsRequireAccount` and the accounts module is installed: BOTH the sender and the recipient need a linked account to start a DM (the recipient side keeps the "Message" button hidden; the server refuses `account_required`).
- In-app admin = `profiles.is_admin` (R6). Existing DMs keep working if a member later turns off "Receive direct messages" (the switch only blocks new DMs). _(Our call.)_
- Copy in all 23 locales, theme tokens only, iOS + Android + web, events ids-only, migrations append-only/idempotent, docs + roadmap + changeset in the same PR, commits `feat: …`/`fix: …` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sandbox `vjcdpodsrpemanfvrshh` only, production never. Gesture worklets follow `utils/chatGestures.ts` (export const arrows).

## Review Focus

1. **Decline, then cooldown, then a new request.** The recipient never sees pre-cooldown messages; the sender's view never changes; `send_message` after the cooldown re-opens the request exactly once (no duplicate push). → Task 1 SQL test and Task 2 push test.
2. **A block during a pending request or an active DM.** Neither side can send; the request disappears from the recipient's list; pushes stop; the open screens close the composer (members broadcast). → Task 1 SQL test, Task 4 UI test.
3. **Two people messaging each other first at the same moment.** Exactly one DM conversation per pair (unique pair index + advisory lock in `start_dm`), both active (a mutual start counts as accepted). → Task 1 SQL test.
4. **Request recipient opens the request** (reads, typing channel): no read state written for them, no "Seen", no typing sent from them. → Task 1 SQL test (`mark_conversation_read` is a no-op in `request` state), Task 4 test (no `notifyTyping` in request mode).
5. **Account merge with two DMs to the same peer.** One conversation survives with both histories, no orphan request. → Task 1 SQL test.

---

### Task 1: Backend `dms/001` — tables, settings, RPCs, read rules

**Files:**

- Create: `supabase/migrations/dms/001_dms.sql`, `supabase-tests/dms.sql`
- Modify: `packages/cli/src/install-shared.ts` (`"dms"` after `"groups"` in `MODULE_ORDER`, `dms` implies `messaging`), `packages/cli/src/index.ts` (help), `packages/cli/src/__tests__/init.test.ts`

**Interfaces (produces):**

- `profiles.accepts_dms boolean not null default true` + RPC `set_accepts_dms(p_on boolean) returns void` (own profile; not through update-profile — no text to moderate).
- `dm_pairs(conversation_id uuid pk → conversations on delete cascade, user_a uuid, user_b uuid, check (user_a < user_b), unique (user_a, user_b))`.
- `conversation_members` gains `visible_from timestamptz` (null = everything) — used only for DM recipients; state check extended with `'declined'`.
- `dm_declines(sender_id, recipient_id, until timestamptz, pk(sender_id, recipient_id))`; `dm_request_log(sender_id, recipient_id, at)` (requests-per-day counter). No client grants on either.
- Settings keys per Global Constraints (seed with `jsonb ||` keeping existing values; extend `messaging_set_settings` validation and `messaging_client_settings` output).
- `start_dm(p_recipient uuid) returns uuid` — not self, recipient exists and not banned, caller not banned, `accepts_dms`, no block either way (`blocked_member_ids()` + reverse), account rule for both, cooldown (`dm_declines.until > now()` ⇒ `raise 'declined_recently'` — but see silent-decline rule: the SENDER of an existing declined DM never gets this error; only a brand-new DM to someone who declined them before raises it), `requestsPerDay` (count `dm_request_log` last 24 h ⇒ `raise 'too_many_requests'`). Takes `pg_advisory_xact_lock(hashtextextended('dm:'||least||greatest,0))`. Get-or-create via `dm_pairs`. New conversation: sender `active`; recipient `request` when `dmsFirstMessage = 'requests'` else `active`; logs a request. If the recipient had already started a DM to the caller (state request for the caller), the caller's start accepts it (both active).
- `send_message` (create or replace from `messaging/006` body) for kind `dm`: the caller must be `active`; no block either way (`raise 'blocked'`); if the recipient's row is `declined` and its `dm_declines.until <= now()`: set recipient `state = 'request'`, `visible_from = now()`, log a request (the push in Task 2 fires once for this new request); if still within cooldown: store the message normally (sender sees it), recipient never sees it (`visible_from` stays in the future relative to those messages — set `visible_from` to the cooldown end at decline time).
- `can_read_conversation` (replace from `messaging/001`): kind `dm` ⇒ caller row state in (`active`, `request`) and not blocked either way; groups unchanged.
- Messages read policy (replace): also requires `created_at >= coalesce(my_member.visible_from, '-infinity')` for DMs.
- `mark_conversation_read`: no-op while my state is `request`.
- `accept_request(p_conversation uuid) returns void` (recipient in `request` ⇒ `active`; inbox `dm_request_accepted` for the sender when the inbox module exists, `conversation_id` set — same guarded pattern as groups).
- `decline_request(p_conversation uuid) returns void` (recipient ⇒ `declined`; `dm_declines` upsert until `now() + dmsDeclineCooldownDays`; `visible_from` = that `until`).
- `block_and_report_request(p_conversation uuid, p_reason text) returns void` (inserts `blocks`, a `reports` row on the request's latest message with `reported_user_id` = sender, then declines).
- `dm_peers() returns table(conversation_id uuid, peer_id uuid, my_state text)` (caller's DMs in `active` or `request`, blocked pairs excluded).
- `list_dm_requests() returns table(conversation_id uuid, sender_id uuid, last_body text, last_has_image boolean, last_at timestamptz, groups_in_common int, common_group_names text[] /* up to 3, live names */, member_since timestamptz)` (caller's rows in `request` state, newest first).
- `dm_peer_read(p_conversation uuid) returns timestamptz` — the peer's `last_read_at` only when `dmsReadReceipts` and both rows are `active`; else null.
- `unread_followed_messages()` / `unread_followed_messages_for(p_uid)` (replace from latest): DMs in `active` always count as followed (their `notify` flag is ignored), plus one per pending request.
- `messaging_on_account_delete` (replace): `eraseDms` deletes the member's messages in DMs (images left to the storage sweep).
- `merge_messaging` (replace): two DMs with the same peer ⇒ keep the older conversation, move the other's messages into it, delete the other; `dm_pairs` rewritten to the kept profile; `dm_declines`/`dm_request_log` rows moved.
- `admin_message_context`: unchanged (its DM branch already requires a report or an AI hide) — assert it in the test.

- [ ] **Step 1: CLI test** (`init.test.ts`): `--modules core,dms` ⇒ `["core","messaging","dms"]`. Run, see it fail.
- [ ] **Step 2: SQL test `supabase-tests/dms.sql`** (`do $$` + raise `DMS_TESTS_PASSED`), members `a, b, c, x`:
  - `requests` mode: `a` starts a DM with `b` ⇒ `b` state `request`; `b` reads `a`'s messages; `b` calling `mark_conversation_read` leaves `last_read_at` null; `dm_peer_read` for `a` is null.
  - mutual start: `b` starts with `a` while `a`'s request is pending ⇒ one conversation, both `active`.
  - decline: `b` declines `a`; `a` sends 2 more (ok, stored); `b` selects 0 of them and 0 of the pre-decline ones; after forcing `until` into the past, `a`'s next send makes `b` `request` and `b` sees only that message.
  - block: `a` blocks `b` ⇒ `send_message` either way raises `blocked`; `dm_peers`/`list_dm_requests` exclude the pair; `x` (non-member) reads nothing.
  - `accepts_dms = false` ⇒ `start_dm` raises `dms_off`; an existing active DM still sends.
  - `too_many_requests` after `dmsRequestsPerDay`; `declined_recently` for a new DM to someone who declined within the cooldown.
  - with the accounts module and `dmsRequireAccount = true`: start without a link ⇒ `account_required`.
  - `unread_followed_messages` counts DM unread + 1 per pending request.
  - `eraseDms` removes `a`'s DM messages, keeps group messages.
  - merge: two DMs `a↔b`, `a'↔b` merged into `a` ⇒ one conversation, all messages.
  - `admin_message_context` on an unreported DM message ⇒ `forbidden`.
- [ ] **Step 3: Implement** `dms/001_dms.sql` + CLI wiring.
- [ ] **Step 4: Apply on the sandbox, run `dms.sql`, `messaging.sql`, `groups.sql`, `blocks.sql`** ⇒ all `*_PASSED`; `npm test -w @rocapine/community`.
- [ ] **Step 5: Commit** `feat: dms module — requests, silent decline, read receipts`.

### Task 2: DM pushes, notification switch, inbox and Slack

**Files:**

- Create: `supabase/migrations/dms/002_push.sql` (guarded on `push_tokens`: `notify_dms boolean not null default true`; `claim_message_push` replaced from `messaging/002` latest body to: treat DM members as followers regardless of `notify`, skip `notify_dms = false`, skip recipients whose row is `declined` or whose `visible_from` is after the message, and return a `kind` column `'message' | 'request'` — `'request'` only for the first message of a request (no earlier message of this request visible to the recipient))
- Modify: `supabase/functions/notify-message/index.ts`, `supabase/functions/_shared/copy.ts` (+ test), `supabase/functions/report-to-slack/index.ts` (DM report: sender/recipient handles, no text — verify the existing branch), `packages/core/src/service.ts` (`notify_dms` in `NOTIFICATION_PREFERENCE_KEYS`, gated on `modules.dms` via `notificationPreferenceKeys(cfg)`).
- Copy keys (all 23 locales): `message.dmBody` (`{sender}` for `pushPreview: "sender"`), `message.request` (neutral).

- [ ] **Step 1: Failing Deno tests:** `dmPushPayload` (pure, in `_shared/messaging.ts`): `kind: "request"` ⇒ title app name, body `message.request`, no sender/text whatever `pushPreview`; `kind: "message"` in a DM ⇒ title = sender name, body per `pushPreview`.
- [ ] **Step 2: Implement**, apply 002 on the sandbox, redeploy `notify-message` (and `report-to-slack`) keeping verify_jwt.
- [ ] **Step 3: Sandbox check:** a new request pushes once (neutral), its second message doesn't; after accept, 3 quick DMs push once; `notify_dms = false` ⇒ none; a declined sender's messages ⇒ none.
- [ ] **Step 4: Commit** `feat: dm pushes, notify_dms switch`.

### Task 3: Core — config, services, hooks, events

**Files:** `packages/core/src/config.ts`, `models.ts`, `schema-check.ts`, `messaging-service.ts` (DM functions) or a new `dms-service.ts`, `messaging-hooks.ts`, `events.ts`, `keys.ts`, `index.ts`; tests `config.test.ts`, `schema-check.test.ts`, `dmsService.test.ts`, `messagingHooks.test.ts`.

**Interfaces (produces):**

- `DmsConfig`, `dmsSettings(cfg): ResolvedDms | null`; `messagingSettings` non-null with groups or dms; schema-check compares the 5 new keys.
- `Conversation` gains `peerId: string | null`, `requestState: "active" | "request" | null` (from `dm_peers`, merged in `fetchConversations` for `kind === "dm"`).
- `DmRequest { conversationId; senderId; lastBody: string | null; lastHasImage: boolean; lastAt: string; groupsInCommon: number; commonGroupNames: string[]; memberSince: string }`.
- Services: `startDm(cfg, recipientId, source: "profile" | "newMessage" | "contextMenu"): Promise<string>`, `fetchDmRequests(cfg)`, `acceptRequest`, `declineRequest`, `blockAndReportRequest(cfg, id, reason)`, `setAcceptsDms(cfg, on)`, `fetchPeerRead(cfg, conversationId): Promise<string | null>`, `searchMembers(cfg, query)` (for the "newMessage" picker: reuse an existing profile search if core has one, else select `profiles` by username ilike, excluding blocked, banned and `accepts_dms = false`, limit 20).
- `MessagingError` codes add `dms_off`, `declined_recently`, `too_many_requests`, `blocked` (if missing).
- Hooks: `useStartDm`, `useDmRequests`, `useAcceptRequest`, `useDeclineRequest`, `useBlockAndReportRequest`, `useSetAcceptsDms`, `usePeerRead(conversationId)` (refetch on Realtime change and focus), `useMemberSearch(query)`. `useMessagingBadge` includes DMs + requests (via `unread_followed_messages`).
- Events: `community_dm_started {source}`, `community_dm_request_accepted`, `community_dm_request_declined`, `community_dm_request_blocked`.

- [ ] **Step 1: Failing tests:** `dmsSettings` defaults; `messagingSettings` non-null with dms only; `startDm` maps `dms_off`/`declined_recently`/`too_many_requests`; `fetchConversations` attaches `peerId`/`requestState` for DMs; `usePeerRead` null when receipts off; schema-check warns on `dmsFirstMessage` mismatch.
- [ ] **Step 2: Implement. Step 3: run** core tests, build, typecheck. **Step 4: Commit** `feat(core): direct messages`.

### Task 4: UI — Conversations tab, Requests, DM conversation

**Files:** `MessagesScreen.tsx`, create `screens/RequestsScreen.tsx`, `ConversationScreen.tsx`, `components/chat/*` as needed, `utils/chat.ts` (pure helpers), locales (23), `index.ts`; tests `dms.test.ts`.

- `MessagesScreen`: with dms on, `hubLayout: "tabs"` shows "Conversations" (Requests row on top with its count when > 0, then DMs: peer avatar + online dot, name, last message, time, unread count) and "Groups" (as today; with groups off, no tabs). `"unified"`: one list, Requests row on top. `initialTab` honoured.
- `RequestsScreen` props `{ onOpenRequest(conversationId: string): void; onBack(): void }` (validated mockup B list).
- `ConversationScreen` for `kind: "dm"`: header = peer avatar, name, green "● online" when online (presence), tap ⇒ `onOpenProfile(peerId)`; no names above bubbles (already); "Seen" under my last read message when `usePeerRead` is non-null and ≥ its `createdAt`; **request mode** (my state `request`): read-only, sender context under the header (`groups in common` with up to 3 names, "Member since <month year>"), bar Accept / Decline / Block and report (report reasons reuse `ReportSheet`), no typing sent, no mark-read; Accept turns the screen live in place; Decline/Block close it (`onBack`). The sender sees a normal conversation (silent).
- Closed states: blocked ⇒ the composer becomes `chat.blocked` ("You can't write to this member").

- [ ] **Step 1: Failing tests** (pure helpers): request-mode decision from `requestState`; "Seen" placement (last own message with `createdAt <= peerRead`); requests row hidden at 0; sender-context line formatting; copy keys in all locales.
- [ ] **Step 2: Implement. Step 3: run** ui tests, build, typecheck, prettier. **Step 4: Commit** `feat(ui): DM conversations and requests`.

### Task 5: UI — entry points, profile switch, header, inbox row

**Files:** `ProfileScreen.tsx` ("Message" button), `ProfileEditSheet.tsx` ("Receive direct messages" switch next to presence/badges), `CommunityPost.tsx` / `ThreadSheet.tsx` menus ("Message" for `contextMenu`), create `components/NewMessageSheet.tsx` (member picker for `newMessage`, opened from a `+`/pencil in the Conversations tab), `utils/headerZones.ts` (stop dropping `"dms"` when dms is on), `CommunityFeedScreen.tsx` (pass `dms: !!dmsSettings`), `NotificationInboxScreen.tsx` + `utils/inboxRow.ts` (kind `dm_request_accepted` ⇒ open the DM), locales, tests.

- "Message" visibility rule (pure, tested): hidden on my own profile, when the member refuses DMs (`accepts_dms` false — expose it on the profile fetch), when either side blocked, and with `requireAccount` when the member has no account (expose `has_account` on the profile fetch via a security-definer field or RPC — never the account id). With `requireAccount` and no account of my own ⇒ `host.onAccountRequired("dm")`.
- Tap ⇒ `startDm` ⇒ `onOpenMessages({ conversationId })`; event `community_dm_started {source}`.
- Header `"dms"` item opens Messages on the Conversations tab, badge per `messaging.badge`. Docs note: with `homeLayout: "segmented"`, hosts use `"dms"` in the header.

- [ ] **Step 1: Failing tests:** `canMessage(profile, me, settings)` rule table; `resolveHeaderZones` keeps `"dms"` with dms on; inbox row target for `dm_request_accepted`; copy keys.
- [ ] **Step 2: Implement. Step 3: run** tests, build, typecheck, prettier. **Step 4: Commit** `feat(ui): DM entry points, profile switch, header item`.

### Task 6: Example app, docs, changeset

- Example app: `modules.dms` toggle + `firstMessage` / `readReceipts` / `entryPoints` chips; routes for Requests; "Message" wiring.
- Docs: integration.md (DMs: config, entry points, requests, receipts, pushes, `notify_dms`, account rule), backend-runbook.md (dms module, order, functions), dashboard-roadmap.md (coverage rows; brick 22 gains DM reports: context only for reported/AI-hidden), spec updated where implementation decided something new (our calls above).
- Changeset entry for DMs.
- [ ] Run root `npm test`, build, typecheck, `npx prettier --check .`; commit `feat: dms in the example app, docs`.

### Task 7: Verification on iOS, Android, web + recording

- Sandbox: all migrations + functions current; SQL tests pass.
- Two members (iOS = A, Android = B), web third: `firstMessage: "requests"`: A messages B from the profile ⇒ B gets one neutral push (Android shade), sees the request with context, reads it (A sees no "Seen"), accepts ⇒ live chat both ways, typing, "Seen" with `readReceipts: true`; decline path (A keeps writing, B sees nothing; cooldown forced in the past ⇒ new request shows only the new message); block-and-report path; `accepts_dms` off hides the button; header `dms` item + badge; `newMessage` picker; `contextMenu` entry; `direct` mode.
- Record a DM walkthrough on iOS (~60–90 s, clean status bar, no suppressed errors), compress (`ffmpeg … -crf 28 -vf scale=-2:1280 -an`).
- Then the final whole-branch review and the PR (stacked on #120, base `feat/messaging-groups`), with the video.
