# Messaging, part 1: chat core + groups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship public group chats in the Community SDK, on a chat core that DMs (part 2) will reuse: bubbles, likes, quoted replies, edits, deletions, images, attachments, Realtime, typing, moderation, on-demand translation, the Messages page, Explore, group details, the "join the group" card, and the "Feed | Groups" home.

**Architecture:** Two new migration modules: `messaging` (conversations, members, messages; generic) and `groups` (group metadata, membership rules, explore). Every write goes through security-definer RPCs that read their limits and modes from a backend `messaging_settings` row, never from the client. Moderation reuses `moderate-one` (new kinds `message` and `group`); a message pushes once it is visible **and** moderated, through a pg_net trigger to a new `notify-message` function, like `notify-comment`. The client reads messages with plain selects under RLS, listens with Realtime `postgres_changes`, and sends typing over a private Realtime broadcast channel per conversation.

**Tech Stack:** Supabase Postgres (SQL migrations, RLS, security-definer RPCs, Realtime, Storage), Deno Edge Functions, TypeScript, TanStack Query v5, React Native (+ react-native-web), Vitest, `@rocapine/community` CLI, changesets.

**Spec:** `docs/superpowers/specs/2026-11-27-messaging-design.md` (slices 1 and 2). Mockups: Unchaind repo, `docs/superpowers/specs/messaging-mockups/` (private; ask for them if you can't read that repo).

**Follow-up plans (not this one):** part 2 = DMs (`dms` module, requests, read receipts); part 3 = Unchaind integration; the dashboard is a separate session in `Rocapine/community-dashboard`.

## Global Constraints

- Release as **0.22.0** (minor): new modules, new config keys, nothing removed. Everything is off unless `modules.groups` is set; a host that doesn't set it gets byte-identical behaviour.
- Config, exact names and defaults (spec "Config"): `messaging?: { moderation: "pre"|"post"|"reportOnly" = "post"; translation: "off"|"onDemand" = "onDemand"; typingIndicator = true; badge: "followed"|"all"|"dot" = "followed"; hubLayout: "tabs"|"unified" = "tabs"; homeLayout: "header"|"segmented" = "header"; pushPreview: "full"|"sender"|"none" = "full"; onAccountDelete: "keep"|"eraseDms"|"eraseAll" = "keep"; maxLength = 2000; ratePerMinute = 20 }`; `modules.groups?: { preview: "readOnly"|"none" = "readOnly"; exploreLayout: "list"|"cards" = "list"; shareCardLayout: "card"|"banner" = "card"; requireAccount: boolean|"feed" = "feed"; createRequiresAccount = true; maxCreatedPerMember = 3; maxJoinedPerMember = 50; maxMembers: number|null = null; nameMaxLength = 60; descriptionMaxLength = 500 } | false`. Database caps: message 4000, name 120, description 1000.
- The backend enforces from `public.messaging_settings` only (one row, `id = 1`), set by `messaging_set_settings(jsonb)` (service role / admin). Client values must equal backend values; `schema-check.ts` warns at startup when they differ.
- **Account rules on the server** read `public.account_links` only when the `accounts` module is installed (`to_regclass('public.account_links') is not null`). Without it, `createRequiresAccount` and `requireAccount: true` don't apply (nobody could ever pass them). `requireAccount: "feed"` is client-only: it runs the feed screen's `beforeCompose` gate before joining or sending.
- Group notifications are **off** by default per member; the member-wide switch is a new `push_tokens.notify_group_messages boolean default true` (same pattern as `notify_likes`). This supersedes the spec's separate `notification_preferences` table: `push_tokens` is already one row per profile.
- Messages create **no** notification-center rows. The center gets `group_approved`, `group_field_rejected`, `group_member_removed` (inbox module, new nullable `notifications.conversation_id`). The app-icon badge = center unread + unread messages of followed groups.
- "Show presence, never absence": "X online" only when X > 0, hidden members excluded, needs the presence module.
- Platforms: iOS, Android **and web** (react-native-web), each verified on device/simulator/browser in Task 13.
- Copy in all 23 locales of `packages/ui/src/locales/*` (`fr-vous` included), added in the task that introduces the string. No message text in analytics.
- Repo rules: update `docs/dashboard-roadmap.md` (coverage table + bricks) in the same PR; changeset; commits `feat: …` / `docs: …` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; migrations append-only, idempotent (`if not exists`, `create or replace`, `drop policy if exists`).
- Open Expo dev clients with `__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1`. The PR embeds a simulator walkthrough recording.
- Production Supabase migrations of any host run only after Guillaume says yes in chat. The sandbox project may be used freely.

## Review Focus

1. **Moderation hides a message after others saw it** (`post` mode). Realtime can't deliver an update to a row RLS no longer lets you read, so open screens keep showing it. → Task 8: the message list refetches the conversation's newest page whenever a Realtime `UPDATE` arrives or the channel reconnects, and a hidden id disappears; test `useMessages drops a message that became unreadable`.
2. **A member removed, or a group deleted, while they have it open.** The composer must turn into a read-only line, sends must fail with a clear error, and Realtime must stop. → Task 2 SQL test (`send_message` raises `not_a_member` after removal) and Task 9 test (`ConversationScreen shows the removed state on not_a_member`).
3. **Quoting a message that is not loaded or was deleted.** The quote shows the current text or "Message deleted"; tapping scrolls to it, loading older pages until found, and stops at the conversation's start. → Task 9 test `findOrLoadMessage stops at the first page`.
4. **Rate limit and length cap from a stale client** (client says 4000, backend 2000). The RPC refuses, and the UI shows the backend's error, keeping the draft. → Task 1 SQL test (`message_too_long`, `rate_limited`) and Task 8 mutation test (draft restored on error).
5. **Web**: Realtime reconnect after the tab sleeps, image picking without the native picker, and the long-press menu (no long-press on desktop: right-click / a "…" button). → Task 9 (menu opens on `onContextMenu` on web) and the Task 13 web checklist.

---

### Task 1: Backend `messaging/001` — conversations, messages, likes, settings, Realtime, storage

**Files:**

- Create: `supabase/migrations/messaging/001_messaging.sql`
- Create: `supabase-tests/messaging.sql`
- Modify: `packages/cli/src/install-shared.ts` (`MODULE_ORDER`: `"messaging"` after `"accounts"`; `"groups"` implies `"messaging"` the way `"streaks"` implies `"badges"`)
- Modify: `packages/cli/src/index.ts` (module list in help)
- Test: `packages/cli/src/__tests__/init.test.ts`

**Interfaces (produces):**

- Tables: `conversations(id uuid pk, kind text check in ('dm','group'), created_at, last_message_at)`; `conversation_members(conversation_id, user_id → profiles, role text check in ('member','creator') default 'member', state text check in ('active','request','removed') default 'active', notify boolean default false, joined_at, last_read_at timestamptz, removed_by uuid, removed_at, primary key(conversation_id,user_id))`; `messages(id uuid pk, conversation_id, author_id → profiles, body text check(char_length(body) <= 4000), image_path text, attachment_type text, attachment_id text, reply_to_id uuid → messages on delete set null, status text check in ('pending','visible','hidden','deleted') , deleted_by text check in ('author','creator','admin'), moderation_reason text, moderated_at timestamptz, edited_at, lang text, created_at)`; `message_likes(message_id, user_id, created_at, pk)`; `message_versions(id, message_id, body, image_path, replaced_at)` (RLS on, no policy: dashboard only); `message_translations(message_id, locale, body, engine, created_at, pk(message_id, locale))`; `messaging_settings(id int pk check(id=1), settings jsonb not null)` seeded with the spec defaults as JSON keys `moderation, translation, pushPreview, onAccountDelete, maxLength, ratePerMinute, groupsPreview, groupsRequireAccount (boolean, false when "feed"), groupsCreateRequiresAccount, maxCreatedPerMember, maxJoinedPerMember, maxMembers, nameMaxLength, descriptionMaxLength`.
- Helper: `public.messaging_setting(p_key text) returns jsonb` (stable).
- Helper: `public.can_read_conversation(p_conversation uuid) returns boolean` — active member, **or** (kind = 'group' and the group is visible and `groupsPreview = 'readOnly'`; `groups` table checked through `to_regclass`, false when absent).
- Helper: `public.has_account_link(p_uid uuid) returns boolean` — true when `accounts` is not installed.
- Read policies: `messages` select when `can_read_conversation(conversation_id)` and (status in ('visible','deleted') or author_id = auth.uid()) and author not in `blocked_member_ids()`. `conversation_members` select own rows; other members' rows only through `list_conversation_members` (Task 2). `message_likes` select when the message is readable.
- RPCs (security definer, `search_path = public`, execute to `authenticated` only):
  - `send_message(p_conversation uuid, p_body text, p_reply_to uuid default null, p_image_path text default null, p_attachment_type text default null, p_attachment_id text default null) returns public.messages` — checks active member, not banned, not blocked by an active DM peer (part 2 uses it), body or image or attachment present, `char_length(body) <= maxLength` else `raise 'message_too_long'`, at most `ratePerMinute` messages by this author in the last 60 s else `raise 'rate_limited'`, reply target in the same conversation. Status: image present or `moderation = 'pre'` ⇒ `pending`, `moderated_at null`; `post` ⇒ `visible`, `moderated_at null`; `reportOnly` ⇒ `visible`, `moderated_at = now()`. Bumps `conversations.last_message_at`, sets the author's `last_read_at = now()`.
  - `edit_message(p_message uuid, p_body text) returns public.messages` — own, not deleted; copies the old body/image to `message_versions`, deletes its `message_translations`, sets `edited_at = now()`; status/moderated_at reset by the same rule as a new message.
  - `delete_message(p_message uuid) returns void` — author ⇒ `deleted_by = 'author'`; a group creator on a non-admin author ⇒ `'creator'`; an app admin (`admin_users`) ⇒ `status = 'hidden'`, `deleted_by = 'admin'`. Author/creator: body copied to `message_versions`, then `body = null, image_path = null, attachment_* = null, status = 'deleted'`.
  - `set_message_like(p_message uuid, p_liked boolean) returns void` — readable and visible message, caller is an active member.
  - `mark_conversation_read(p_conversation uuid) returns void`.
  - `list_conversations() returns table(conversation_id uuid, kind text, last_message_at timestamptz, last_message_id uuid, last_body text, last_author_id uuid, unread int, notify boolean, role text)` — the caller's active conversations; `unread` = visible messages after `last_read_at` not by the caller and not by blocked members, capped at 99.
  - `unread_followed_messages() returns int` — sum of `unread` over conversations with `notify = true`.
  - `admin_message_context(p_message uuid, p_before int default 20, p_after int default 20) returns setof public.messages` — admins only; for a `dm` conversation it answers only when the message has a report (`reports` row) or `status = 'hidden'` with a `moderation_reason`, else `raise 'forbidden'`.
  - `messaging_set_settings(p_settings jsonb) returns void` — `admin_users` or service role; merges keys.
- Realtime: `alter publication supabase_realtime add table public.messages, public.message_likes` (guarded so re-runs don't fail). Typing: policies on `realtime.messages` — select when `realtime.topic() like 'conversation:%'` and `can_read_conversation(split_part(realtime.topic(), ':', 2)::uuid)`; insert additionally requires an active membership.
- Reports: `alter table public.reports add column if not exists message_id uuid references public.messages(id) on delete set null`; replace the `post_id is not null or comment_id is not null` check with one that also accepts `message_id` (and, from Task 2, `group_id`). A member may report a message they can read.
- Storage: private bucket `message-images`; upload path `<conversation_id>/<uid>/<uuid>.<ext>`; insert policy = active member of that conversation and `uid` = `auth.uid()`; select policy = `can_read_conversation`.

- [ ] **Step 1: Failing CLI test** in `init.test.ts`: `runInit({ modules: "core,groups" })` gives `manifest.modules` `["core", "messaging", "groups"]` and a file containing `_community_messaging_messaging`.
- [ ] **Step 2: Run** `npm test -w @rocapine/community -- init` → FAIL (unknown module).
- [ ] **Step 3: Add the modules to `MODULE_ORDER` / help, and the implication rule;** write `001_messaging.sql` per the Interfaces, header comment style of `presence/001_presence.sql`.
- [ ] **Step 4: Run** `npm test -w @rocapine/community` → PASS (upgrade tests included).
- [ ] **Step 5: Write `supabase-tests/messaging.sql`** in the `blocks.sql` pattern (one `do $$` block, raises `MESSAGING_TESTS_PASSED` to roll back). Profiles `a, b, c, x` (x not a member), one `group`-kind conversation with `a, b` active and `c` removed. Assertions:
  - `b` sends a 2000-char body ⇒ ok; 2001 ⇒ `message_too_long`; 21st message within a minute ⇒ `rate_limited` (settings default 20).
  - `c` sends ⇒ `not_a_member`; `x` select returns 0 rows with `groupsPreview = 'none'`.
  - `moderation = 'post'` ⇒ new row `visible`, `moderated_at` null; `'reportOnly'` ⇒ `moderated_at` set; an image ⇒ `pending`.
  - `a` blocks `b` ⇒ `a` no longer selects `b`'s messages; `list_conversations().unread` for `a` excludes them.
  - `edit_message` ⇒ one `message_versions` row, translations gone, `edited_at` set.
  - `delete_message` by author ⇒ `body is null`, `deleted_by = 'author'`, original in `message_versions`.
  - `admin_message_context` by a non-admin ⇒ `forbidden`.
- [ ] **Step 6: Run** it on the sandbox project (`supabase db query --linked -f supabase-tests/messaging.sql`) → error text `MESSAGING_TESTS_PASSED`.
- [ ] **Step 7: Commit** `feat: messaging module — conversations, messages, likes, settings`.

### Task 2: Backend `groups/001` — groups, membership, explore, admin tools

**Files:**

- Create: `supabase/migrations/groups/001_groups.sql`
- Create: `supabase/migrations/accounts/003_merge_hooks.sql`
- Modify: `supabase/functions/account-delete/index.ts`
- Create: `supabase-tests/groups.sql`

**Interfaces (produces):**

- Tables: `groups(conversation_id uuid pk → conversations, name text check <= 120, description text check <= 1000, image_path text, pending_name, pending_description, pending_image_path, status text check in ('pending','visible','hidden','deleted') default 'pending', rejected_fields text[] default '{}', created_by uuid, member_count int default 1, last_activity_at timestamptz, search tsvector generated from name || description, created_at)` with a GIN index on `search` and an index on `last_activity_at desc`; `group_translations(group_id, locale, name, description, pk)`; `group_removals(group_id, user_id, removed_by, removed_at, pk)`.
- Read: `groups` select when `status = 'visible'` or `created_by = auth.uid()`; `group_translations` when the group is readable. Public bucket `group-images` (only approved paths are ever written to `image_path`; pending images live under `pending/` and are read through signed URLs by the creator and moderation).
- RPCs:
  - `create_group(p_name text, p_description text, p_image_path text default null) returns uuid` — not banned; account rule; `count(created, status <> 'deleted') < maxCreatedPerMember` unless admin else `raise 'too_many_groups'`; lengths else `raise 'name_too_long'` / `'description_too_long'`; joined count < `maxJoinedPerMember` else `'too_many_joined'`. Inserts conversation (`group`), creator membership (`role = 'creator'`, `notify = false`), group `pending` with the values in `pending_*` and the live columns null.
  - `edit_group(p_group uuid, p_name text, p_description text, p_image_path text) returns void` — creator or admin; writes `pending_*`, keeps live values; status unchanged if visible.
  - `delete_group(p_group uuid) returns void` — creator or admin ⇒ `status = 'deleted'`, all memberships `removed`.
  - `join_group(p_group uuid) returns void` — visible, not banned, not in `group_removals`, account rule (`groupsRequireAccount`), `maxMembers`, `maxJoinedPerMember`; idempotent; bumps `member_count`.
  - `leave_group(p_group uuid) returns void` — a creator leaving keeps the group (admins manage it).
  - `remove_member(p_group uuid, p_user uuid) returns void` — creator or admin; never an admin target when the caller is the creator (`raise 'forbidden'`); writes `group_removals`; inbox `group_member_removed` when the inbox module is installed.
  - `readmit_member(p_group uuid, p_user uuid) returns void` — deletes the removal row.
  - `set_group_notify(p_group uuid, p_notify boolean) returns void`.
  - `search_groups(p_query text default null, p_locale text default null, p_limit int default 30, p_before timestamptz default null) returns table(group_id uuid, name text, description text, image_path text, member_count int, last_activity_at timestamptz, is_member boolean)` — visible groups; query matched with `websearch_to_tsquery('simple', …)` on `search` and on `group_translations` of `p_locale`; name/description returned translated when a translation exists; ordered by `last_activity_at desc`.
  - `list_conversation_members(p_conversation uuid, p_query text default null, p_limit int default 50, p_offset int default 0) returns table(user_id uuid, role text, joined_at timestamptz)` — active members only, caller must be an active member (non-members: `raise 'forbidden'`); blocked members excluded.
  - `group_online_counts(p_groups uuid[]) returns table(group_id uuid, online int)` — 0s when `member_presence` doesn't exist; uses `presence_settings` grace, `visible` and not banned, excludes blocked members.
  - `admin_transfer_group(p_group uuid, p_new_creator uuid) returns void`, `admin_edit_group(p_group uuid, p_name text, p_description text, p_image_path text) returns void` (writes live values directly, admins only).
- Trigger: on `messages` insert of a group conversation ⇒ `groups.last_activity_at = now()`.
- Inbox: `alter table public.notifications add column if not exists conversation_id uuid references conversations(id) on delete cascade`, guarded by `to_regclass('public.notifications')`.
- Reports: `reports.group_id uuid references groups(conversation_id) on delete set null`, accepted by the check from Task 1.
- Profile merge (spec "Profile merge"): `public.merge_messaging(p_main uuid, p_other uuid) returns void` moves `conversation_members` (keeping the main row on conflict, the earliest `joined_at`, `notify` OR-ed), `messages.author_id`, `message_likes` (dedup), `groups.created_by`, `group_removals`. Create `supabase/migrations/accounts/003_merge_hooks.sql`: `merge_profiles` calls `merge_messaging(main, other)` when `to_regprocedure('public.merge_messaging(uuid,uuid)') is not null` (copy the 002 body, add the call before the merged profile is deleted).
- Account deletion: `public.messaging_on_account_delete(p_uid uuid) returns void` applies `onAccountDelete` (`keep`: nothing; `eraseAll`: delete the member's messages; `eraseDms`: nothing yet, part 2); `supabase/functions/account-delete/index.ts` calls it before deleting the profile when the function exists.

- [ ] **Step 1: Write `supabase-tests/groups.sql`** (pattern of Task 1; raises `GROUPS_TESTS_PASSED`). Assertions:
  - `create_group` ×3 ok, 4th ⇒ `too_many_groups`; an admin creates a 4th ok.
  - a new group is invisible to `b` (`search_groups` returns 0) until `status = 'visible'` and live values are set.
  - `join_group` by a removed member ⇒ `removed_from_group`; after `readmit_member` ok.
  - creator `remove_member` on an admin ⇒ `forbidden`.
  - `list_conversation_members` by a non-member ⇒ `forbidden`.
  - `search_groups('lyon')` finds a group whose French translation says Lyon when `p_locale = 'fr'`.
  - with the accounts module installed, `create_group` by a profile with no `account_links` row ⇒ `account_required`.
  - `group_online_counts` excludes a hidden member and a member blocked by the caller.
  - `merge_profiles(main, other)` where both are members of one group leaves one active row for `main` and `other`'s messages authored by `main`.
  - a report with only `message_id` inserts; with no target it fails the check.
- [ ] **Step 2: Run on the sandbox** → fails (functions missing).
- [ ] **Step 3: Write `groups/001_groups.sql`** per the Interfaces.
- [ ] **Step 4: Run both SQL tests** on the sandbox → `MESSAGING_TESTS_PASSED`, `GROUPS_TESTS_PASSED`.
- [ ] **Step 5: Commit** `feat: groups module — creation, membership, explore, admin tools`.

### Task 3: Moderation of messages and group fields

**Files:**

- Modify: `supabase/functions/moderate-one/index.ts`
- Modify: `supabase/functions/daily-moderation/index.ts`
- Modify: `supabase/functions/_shared/images.ts` (signed URL for private buckets)
- Create: `supabase/functions/_shared/messaging.ts` (+ `_shared/messaging_test.ts`)
- Modify: `supabase/functions/report-to-slack/index.ts` — a message report shows the group name and the message text; a group report shows its name and description (DM reports come in part 2, without text).

**Interfaces:**

- `moderate-one` body gains `kind: "message" | "group"`.
  - `message`: allowed when `status = 'pending'`, or `status = 'visible' and moderated_at is null`. Caller = author or service. Image read through a 10-minute signed URL of `message-images`. Clean ⇒ `status = 'visible', moderated_at = now()`; flagged ⇒ `status = 'hidden', moderation_reason, moderated_at` (same `sexual/minors` deletion rule). Guard every write with the status it read.
  - `group`: moderates `pending_name`, `pending_description` and `pending_image_path` **separately** (one `moderateItem` call each). All clean ⇒ copy `pending_*` into the live columns (moving an approved image from `pending/` to its final path in `group-images`), clear `pending_*`, `status = 'visible'` if it was `pending`, `rejected_fields = '{}'`, inbox `group_approved` for a new group. Any flagged ⇒ keep live values, `rejected_fields` = the flagged field names, clear only the flagged `pending_*`, inbox `group_field_rejected`. Caller = creator, admin, or service.
- `_shared/messaging.ts`: `export function messageModerationInput(row: { body: string | null; attachment_type: string | null }): string` (body or `""`), `export function groupFieldsToModerate(row): Array<{ field: "name" | "description" | "image"; value: string }>`, `export function nextGroupState(row, flagged: Set<string>): GroupUpdate` (pure; the function applies it).
- `daily-moderation`: adds messages with `moderated_at is null and created_at < now() - interval '5 minutes'`, and groups with any non-null `pending_*` older than 5 minutes, through the same code paths.

- [ ] **Step 1: Failing Deno tests** in `messaging_test.ts`: `nextGroupState` on a new group with all fields clean ⇒ `{ status: "visible", name: pendingName, pending_name: null, rejected_fields: [] }`; with `description` flagged ⇒ live description unchanged, `rejected_fields: ["description"]`, status stays `"pending"` for a new group; `groupFieldsToModerate` skips null fields.
- [ ] **Step 2: Run** `deno test supabase/functions/_shared/messaging_test.ts` → FAIL.
- [ ] **Step 3: Implement** `_shared/messaging.ts`, then the two `moderate-one` branches and the `daily-moderation` sweep; `createSignedUrl` helper `messageImageUrl(path: string): Promise<string | null>` in `_shared/images.ts`.
- [ ] **Step 4: Run** `deno test supabase/functions/_shared/` → PASS; deploy `moderate-one` and `daily-moderation` to the sandbox (`--no-verify-jwt` as today) and check one flagged and one clean message by hand.
- [ ] **Step 5: Commit** `feat: moderate messages and group fields`.

### Task 4: Pushes for group messages, and the shared badge

**Files:**

- Create: `supabase/functions/notify-message/index.ts`
- Modify: `supabase/functions/_shared/push.ts` (`unreadBadge` adds followed unread messages)
- Modify: `supabase/functions/_shared/copy.ts` (+ `copy_test.ts`)
- Create: `supabase/migrations/messaging/002_push.sql` (trigger) — and `push_tokens.notify_group_messages boolean not null default true`, guarded by `to_regclass('public.push_tokens')`.
- Modify: `packages/cli/src/install-shared.ts` (`notify-message` installed with `messaging` when `push` is on)

**Interfaces:**

- Trigger `on_message_ready`: `after insert or update on messages`, fires `community_call_function('notify-message', {record})` when `new.status = 'visible' and new.moderated_at is not null and (tg_op = 'INSERT' or old.moderated_at is null)`.
- `notify-message`: recipients = active members of the conversation with `notify = true` (groups), minus the author, minus members who blocked the author or are blocked by them, minus `push_tokens.notify_group_messages = false`; tokens from `recipientTokens`. Push: `title` = group name (translated to the recipient's locale when known), `body` per `pushPreview` (`full`: `"<sender>: <body>"`, 120 chars; `sender`: copy key `message.groupBody` with `{sender}`; `none`: copy key `message.neutral`), `data = { route: <existing community route>, conversationId }`, `threadId`/`collapseId` = `conversationId`, `badge = unreadBadge(uid)`. At most one push per recipient per conversation per 60 s (check the recipient's `last_read_at` and a `push_sent_at` column on `conversation_members`).
- `unreadBadge(supabase, uid)` now adds `rpc('unread_followed_messages')` called as that user (service role: a `unread_followed_messages_for(p_uid)` service-only variant in `002_push.sql`), falling back to the old count on error. Every `notify-*` therefore sends the new sum.

- [ ] **Step 1: Failing tests:** `copy_test.ts` — `pushCopy("fr", "message.groupBody", { sender: "Jean" })` returns the French string, and every locale in `copy.ts` has `message.groupBody` and `message.neutral`; `push_test.ts` — `unreadBadge` adds the RPC's value to the inbox count with a stubbed client, and returns the inbox count when the RPC errors.
- [ ] **Step 2: Run** `deno test supabase/functions/_shared/` → FAIL.
- [ ] **Step 3: Implement** the copy keys (all `copy.ts` locales), `unreadBadge`, `notify-message`, `002_push.sql`, CLI wiring.
- [ ] **Step 4: Run** the Deno tests → PASS; on the sandbox, a member with `notify = true` receives one push for three quick messages, and none after `set_group_notify(false)`.
- [ ] **Step 5: Commit** `feat: group message pushes and messages in the app badge`.

### Task 5: Translation — group fields at approval, messages on demand

**Files:**

- Modify: `supabase/functions/_shared/translation.ts` (`ensureTranslations` accepts `"group"`)
- Create: `supabase/functions/translate-message/index.ts`
- Modify: `supabase/functions/moderate-one/index.ts` (group approved ⇒ `ensureTranslations(supabase, "group", id)`, not awaited past the response)
- Modify: `packages/cli/src/install-shared.ts` (`translate-message` with `messaging` when `translation` is on)

**Interfaces:**

- `ensureTranslations(supabase, "group", id)`: translates `name` and `description` together into `TARGET_LOCALES`, writes `group_translations`.
- `translate-message` (user JWT required): body `{ messageId: string, locale: string }`; checks the caller can read the message (select it with the caller's JWT client); returns `{ body: string }` from `message_translations` or translates with `translateItem` into that one locale, inserts, returns. `locale` must be in `TARGET_LOCALES` else 400.

- [ ] **Step 1: Failing Deno test** in `translation_test.ts`: the `group` kind builds one request containing both fields and parses both back (`parseGroupTranslation`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; on the sandbox, approving a group writes one `group_translations` row per target locale, and `translate-message` twice for the same message calls OpenAI once.
- [ ] **Step 5: Commit** `feat: translate groups at approval and messages on demand`.

### Task 6: Core config and models

**Files:**

- Modify: `packages/core/src/config.ts`, `packages/core/src/models.ts`, `packages/core/src/schema-check.ts`
- Test: `packages/core/src/__tests__/config.test.ts`, `schema-check.test.ts`

**Interfaces (produces):**

- Types `MessagingConfig`, `GroupsConfig` (spec names), `CommunityModules.groups?: Partial<GroupsConfig> | false`, `CommunityConfig.messaging?: Partial<MessagingConfig>`.
- `export function messagingSettings(cfg): ResolvedMessaging | null` (null when no messaging module is on) and `export function groupsSettings(cfg): ResolvedGroups | null`, with every default from Global Constraints.
- `CommunityHostAdapters.onAccountRequired?: (reason: "dm" | "createGroup" | "joinGroup") => void`.
- Models: `Conversation { id; kind: "dm" | "group"; lastMessageAt: string | null; lastMessage: { id; body: string | null; authorId: string } | null; unread: number; notify: boolean; role: "member" | "creator" }`, `ChatMessage { id; conversationId; authorId; body: string | null; imagePath: string | null; attachment: PostAttachment | null; replyTo: { id; authorId; body: string | null; deleted: boolean } | null; status: "pending" | "visible" | "deleted"; deletedBy: "author" | "creator" | null; editedAt: string | null; createdAt: string; likeCount: number; likedByMe: boolean }`, `Group { id; name; description; imageUrl: string | null; memberCount: number; lastActivityAt: string; isMember: boolean; status: "pending" | "visible"; rejectedFields: string[]; isCreator: boolean }`.
- `schema-check.ts`: when groups is on, read `messaging_settings` once and `console.warn` each key whose value differs from the resolved client config.

- [ ] **Step 1: Failing tests:** `groupsSettings({ modules: { groups: {} } })` equals the full default object; `groupsSettings({ modules: { groups: false } })` is `null`; `messagingSettings` returns `homeLayout: "header"`, `badge: "followed"`, `pushPreview: "full"` by default; schema-check warns `maxLength` when backend says 2000 and client 4000.
- [ ] **Step 2: Run** `npm test -w @rocapine/community-core -- config schema-check` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): messaging and groups config`.

### Task 7: Core service — conversations, messages, groups

**Files:**

- Create: `packages/core/src/messaging-service.ts`, `packages/core/src/groups-service.ts`
- Modify: `packages/core/src/keys.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/messagingService.test.ts`, `groupsService.test.ts` (mocked client, like `service.test.ts`)

**Interfaces (produces):**

- `messaging-service.ts`: `fetchConversations(cfg): Promise<Conversation[]>`; `fetchMessages(cfg, conversationId, opts: { before?: string; limit?: number /* 40 */ }): Promise<ChatMessage[]>` (newest first, joins like counts and the reply target); `sendMessage(cfg, input: { conversationId; body?: string; replyToId?: string; imageUri?: string; attachment?: PostAttachment }): Promise<ChatMessage>` (uploads the image to `message-images` first, then `send_message`, then, when the result is `pending` or `visible && !moderatedAt`, calls `moderateOne(cfg, { kind: "message", id })` without awaiting it for `post`, awaiting it for `pre`/image); `editMessage(cfg, id, body)`; `deleteMessage(cfg, id)`; `setMessageLike(cfg, id, liked)`; `markConversationRead(cfg, conversationId)`; `translateMessage(cfg, id, locale): Promise<string>`; `messageImageUrl(cfg, path): Promise<string>` (signed, cached 50 min); `unreadFollowedMessages(cfg): Promise<number>`; `MessagingError` with `code: "message_too_long" | "rate_limited" | "not_a_member" | "account_required" | "removed_from_group" | "too_many_groups" | "too_many_joined" | "group_full" | "forbidden" | "unknown"` mapped from the Postgres error text.
- `groups-service.ts`: `createGroup(cfg, { name, description, imageUri? }): Promise<string>`; `editGroup`; `deleteGroup`; `joinGroup`; `leaveGroup`; `removeMember`; `readmitMember`; `setGroupNotify(cfg, groupId, notify)`; `searchGroups(cfg, { query?, before? }): Promise<Group[]>` (passes the reader locale); `fetchGroup(cfg, id): Promise<Group | null>`; `fetchGroupMembers(cfg, id, { query?, offset? })`; `fetchGroupOnlineCounts(cfg, ids): Promise<Record<string, number>>` (empty when presence is off).
- Keys: `CONVERSATIONS_KEY`, `messagesKey(conversationId, locale)`, `GROUPS_SEARCH_KEY`, `groupKey(id, locale)`, `groupMembersKey(id)`, `UNREAD_MESSAGES_KEY`.

- [ ] **Step 1: Failing tests:** `sendMessage` maps a `P0001 rate_limited` error to `MessagingError("rate_limited")`; uploads before the RPC and passes the returned path; calls `moderate-one` with `kind: "message"`; `searchGroups` sends `p_locale` from `host.getLocale()`; `fetchGroupOnlineCounts` returns `{}` without calling the RPC when presence is off.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): messaging and groups services`.

### Task 8: Core hooks — lists, Realtime, typing, badge, events

**Files:**

- Create: `packages/core/src/messaging-hooks.ts`, `packages/core/src/realtime.ts`
- Modify: `packages/core/src/events.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/messagingHooks.test.ts`, `realtime.test.ts`

**Interfaces (produces):**

- `useConversations()`, `useMessages(conversationId)` (infinite, newest page first), `useSendMessage()`, `useEditMessage()`, `useDeleteMessage()`, `useToggleMessageLike()`, `useTranslateMessage()`, `useMarkConversationRead(conversationId)` (on focus and on each new message while focused), `useGroupSearch(query)`, `useGroup(id)`, `useGroupMembers(id, query)`, `useCreateGroup()`, `useEditGroup()`, `useJoinGroup()`, `useLeaveGroup()`, `useSetGroupNotify()`, `useRemoveMember()`, `useGroupOnlineCounts(ids)`, `useMessagingBadge(): { count: number; dot: boolean }` (per `messaging.badge`: `followed` ⇒ `unreadFollowedMessages`; `all` ⇒ sum of every `unread`; `dot` ⇒ `{ count: 0, dot: any > 0 }`).
- `realtime.ts`: `subscribeConversation(cfg, conversationId, handlers: { onChange(): void; onTyping(userId: string): void }): () => void` — one channel `conversation:<id>`, `private: true`, `postgres_changes` on `messages` and `message_likes` filtered by `conversation_id` ⇒ `onChange` (debounced 150 ms), `broadcast` `typing` ⇒ `onTyping`; `sendTyping(channel)` throttled to one per 3 s; reconnect ⇒ `onChange`.
- `useMessages` calls `subscribeConversation` while mounted; `onChange` refetches the first page. `useTyping(conversationId): { typingUserIds: string[]; notifyTyping(): void }` (an id expires 5 s after its last event; nothing when `typingIndicator` is false).
- Optimistic send: the message appears at once with `id = "optimistic-…"`; on `MessagingError` it is removed and the draft is returned to the composer through the mutation's `onError` context.
- Events (`events.ts`, via `host.onEvent`, ids only): `community_messages_opened`, `community_conversation_opened {kind}`, `community_message_sent {kind, hasImage, hasAttachment, isReply}`, `community_message_liked`, `community_message_translated`, `community_message_edited`, `community_message_deleted`, `community_message_reported`, `community_group_explore_opened`, `community_group_searched`, `community_group_previewed`, `community_group_joined {source}`, `community_group_left`, `community_group_created`, `community_group_shared`, `community_group_notifications_toggled {on}`, `community_home_segment {segment}`.

- [ ] **Step 1: Failing tests:** `useMessages drops a message that became unreadable` (first page refetched after `onChange`, hidden id gone); `useSendMessage` restores the draft on `rate_limited`; `useTyping` expires an id after 5 s (fake timers); `useMessagingBadge` with `badge: "dot"`; `subscribeConversation` returns an unsubscribe that removes the channel.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test -w @rocapine/community-core` → PASS.
- [ ] **Step 5: Commit** `feat(core): messaging hooks, Realtime and typing`.

### Task 9: UI — the chat screen

**Files:**

- Create: `packages/ui/src/components/chat/MessageBubble.tsx`, `QuoteBlock.tsx`, `MessageMenu.tsx`, `DaySeparator.tsx`, `ChatComposer.tsx`, `TypingLine.tsx`
- Create: `packages/ui/src/screens/ConversationScreen.tsx`
- Create: `packages/ui/src/utils/chat.ts`
- Modify: `packages/ui/src/locales/*.ts` (23 files), `packages/ui/src/index.ts`
- Test: `packages/ui/src/__tests__/chat.test.ts`

**Interfaces:**

- `ConversationScreen` props: `{ conversationId: string; mode?: "member" | "preview"; onOpenProfile(userId: string): void; onOpenGroupDetails?(): void; onOpenAttachment?(a: PostAttachment): void; onBack(): void; beforeSend?: () => Promise<boolean> }`. Layout per the validated "bubbles" mockup and spec "Chat screen": own messages right in `theme.colors.accent`, others left with avatar + name (name hidden for `dm`), like pill, quote inside the bubble, "edited", day separators, typing line, image opens `ImageViewer`. Group header: avatar, name, "N members · X online" (online only when > 0), bell toggle (`useSetGroupNotify`), tap ⇒ `onOpenGroupDetails`.
- `mode: "preview"`: no composer, a "Join" bar (`useJoinGroup`, source `"preview"`); joining switches to member mode in place.
- Removed / deleted group / `not_a_member` error ⇒ the composer is replaced by the line `chat.removed` / `chat.groupDeleted`.
- Menu (long-press; `onContextMenu` and a "…" button on web): Like, Reply, Copy, Translate (when `translation = "onDemand"` and the module is on), Edit/Delete (own), Report (reuses `ReportSheet` with a new `kind: "message"`), Delete (creator / admin, on others).
- `utils/chat.ts`: `groupByDay(messages, now): Array<{ day: string; items: ChatMessage[] }>`, `quoteExcerpt(body: string | null, deleted: boolean): string` (first 2 lines, max 120 chars, ends with "…" when cut; `chat.deleted` text when deleted), `findOrLoadMessage(id, pages, loadOlder): Promise<number | null>` (index, loads older pages until found or no more pages ⇒ `null`).
- New copy keys (all locales): `chat.placeholder`, `chat.edited`, `chat.deleted`, `chat.deletedByCreator`, `chat.typing.one`, `chat.typing.many`, `chat.menu.like|reply|copy|translate|edit|delete|report`, `chat.removed`, `chat.groupDeleted`, `chat.join`, `chat.members.*` (plural), `chat.online.*` (plural, reuse presence categories), `chat.error.tooLong|rateLimited|generic`.

- [ ] **Step 1: Failing tests:** `quoteExcerpt` of a 3-line body returns 2 lines + "…"; of a deleted message returns the `chat.deleted` copy; `groupByDay` splits at local midnight; `findOrLoadMessage stops at the first page`; i18n test (existing `i18n.test.ts`) covers the new keys in every locale.
- [ ] **Step 2: Run** `npm test -w @rocapine/community-ui` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat(ui): conversation screen`.

### Task 10: UI — Messages page, Explore, create / edit, details, members

**Files:**

- Create: `packages/ui/src/screens/MessagesScreen.tsx`, `ExploreGroupsScreen.tsx`, `GroupDetailsScreen.tsx`, `GroupMembersScreen.tsx`, `packages/ui/src/components/GroupFormSheet.tsx`, `packages/ui/src/components/GroupRow.tsx`
- Modify: locales, `packages/ui/src/index.ts`
- Test: `packages/ui/src/__tests__/groups.test.ts`

**Interfaces:**

- `MessagesScreen` props: `{ initialTab?: "conversations" | "groups"; onOpenConversation(id: string): void; onOpenExplore(): void; onBack(): void }`. `hubLayout: "tabs"`: tabs "Conversations" / "Groups" with their unread counts; in this part the Conversations tab is only rendered once DMs exist (part 2), so with groups alone the page shows the groups list without tabs (spec: "only one of the two modules on"). `"unified"`: one list by `lastMessageAt`, groups with a rounded-square avatar, "Explore groups" at the bottom. Muted groups: grey count.
- `ExploreGroupsScreen` props: `{ onOpenGroup(id: string, preview: boolean): void; onBack(): void; beforeCreate?: () => Promise<boolean> }`. Search field (debounced 300 ms, `community_group_searched` on submit), rows per `exploreLayout` (`list` = `GroupRow`, `cards` = banner card), "N members · X online", "Join" / "Open", `+` ⇒ `GroupFormSheet`. Create: account rule ⇒ `host.onAccountRequired("createGroup")` when `createRequiresAccount` and the profile has no account link (`useAccountState()` from the accounts module; without it, allowed).
- `GroupFormSheet` props: `{ mode: "create" | "edit"; group?: Group; onDone(id: string): void; onClose(): void }`. One sheet per the validated mockup: optional image, name (counter `n / nameMaxLength`), description (counter), the line `groups.form.publicNote`. After create: the creator lands in the conversation with the "Under review" badge; `rejectedFields` shows `groups.review.rejected.<field>` with an edit action.
- `GroupDetailsScreen` props: `{ groupId: string; onOpenMembers(): void; onShare(group: Group): void; onLeft(): void; onBack(): void }`. Settings list per the validated mockup: header, Notifications switch, Members (count; members only), Share in the community, Report, Leave; creator/admin: Edit, and Remove/Readmit in `GroupMembersScreen`.
- `groups.test.ts`: pure helpers in `utils/groups.ts` — `onlineLabel(count): string | null` (null at 0), `exploreRowAction(group): "join" | "open"`, `canManage(group, isAdmin): boolean`.

- [ ] **Step 1: Failing tests** for the three helpers and the new copy keys in every locale.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** tests + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(ui): messages page, explore, group details`.

### Task 11: UI — header items, "Feed | Groups" home, the group card

**Files:**

- Modify: `packages/ui/src/utils/headerZones.ts`, `packages/ui/src/screens/CommunityFeedScreen.tsx`, `packages/ui/src/components/AttachmentCard.tsx`, `packages/ui/src/components/ComposerSheet.tsx`
- Create: `packages/ui/src/components/GroupsHome.tsx`, `packages/ui/src/components/GroupAttachment.tsx`
- Test: `packages/ui/src/__tests__/headerZones.test.ts`, `attachment.test.ts`, `composer.test.ts`

**Interfaces:**

- `FeedHeaderItem` gains `"messages" | "groups" | "dms"`; `resolveHeaderZones(config, opts: { inbox; online; messaging: boolean; dms: boolean })` drops `"messages"`/`"groups"` when messaging is off and `"dms"` when DMs are off (always, in this part). Each item shows `useMessagingBadge()`.
- `CommunityFeedScreen` new props: `onOpenMessages?(target?: { conversationId?: string; groupId?: string; preview?: boolean; tab?: "conversations" | "groups" }): void`, `onOpenExplore?(): void`. With `homeLayout: "segmented"` and groups on: a full-width "Feed | Groups" selector under the header (validated mockup A), the Groups segment's unread badge, segment kept in component state for the session, `community_home_segment` on change. `GroupsHome`: search field (opens Explore), "My groups" (`useConversations` filtered to groups), "To discover" (`useGroupSearch` minus joined, 5 rows, "See all"), "Create a group".
- Built-in attachment `{ type: "group", id }`: `AttachmentCard` renders `GroupAttachment` unless the host's `renderAttachment` returns non-null for it. Variants: `"card"` (feed, default), `"banner"` (`shareCardLayout`), `"compact"` (inside a message bubble — Task 9 passes `variant="compact"`). Deleted ⇒ `groups.card.gone`. Button: "Join" (source `"share"`) / "Open".
- `ComposerSheet` accepts `initialAttachment?: PostAttachment`; `canAttach` allows `type: "group"` even when `modules.attachments` is off. `GroupDetailsScreen.onShare` ⇒ host opens the composer with it.

- [ ] **Step 1: Failing tests:** `resolveHeaderZones` keeps `"messages"` only with messaging on and drops `"dms"`; `attachment.test` — a `group` attachment resolves to the built-in renderer when the host renderer returns null, and to the host's when not; `composer.test` — `canPublish` accepts a group attachment with `modules.attachments` off.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** tests + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(ui): messages header items, Feed | Groups home, group card`.

### Task 12: Inbox rows, example app, docs, changeset

**Files:**

- Modify: `packages/ui/src/screens/NotificationInboxScreen.tsx` (+ `inboxRow.test.ts`): kinds `group_approved`, `group_field_rejected`, `group_member_removed`, opening `onOpenMessages({ groupId })`.
- Modify: `packages/core/src/inbox-service.ts` (select `conversation_id`)
- Modify: `examples/expo-app/src/**` (routes for Messages, Conversation, Explore, Details, Members; config with `modules.groups: {}` and a toggle for `homeLayout`)
- Modify: `docs/integration.md` (Messaging section), `docs/dashboard-roadmap.md` (coverage rows for `messaging`/`groups`, a messaging brick for the dashboard session: moderation queue, `admin_message_context`, message versions, group management with `admin_edit_group`/`admin_transfer_group`), `docs/backend-runbook.md` (new functions, secrets unchanged, `messaging_set_settings`)
- Create: `.changeset/messaging-groups.md` (minor for core, ui, cli)

- [ ] **Step 1: Failing test** `inboxRow.test.ts`: a `group_approved` row maps to the `inbox.groupApproved` copy and target `{ groupId }`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** rows, example app, docs, changeset. **Step 4: Run** `npm test && npm run typecheck` at the root → PASS.
- [ ] **Step 5: Commit** `feat: group inbox rows, example app, docs`.

### Task 13: Verification on iOS, Android and web, then the PR

- [ ] **Step 1:** Install the modules on the sandbox project with the CLI from this branch (`community upgrade`), deploy `moderate-one`, `daily-moderation`, `notify-message`, `translate-message`, run both SQL tests → PASS strings.
- [ ] **Step 2:** In the example app on the iOS simulator and the Android emulator (two signed-in members, A and B): create a group (A sees "Under review", then approved), B finds it in Explore, previews it read-only, joins; messages flow both ways live; typing line; like; reply and tap-to-scroll on a quote 3 pages up; edit ("edited"); delete ("Message deleted"); translate; image message (pending, then shown); bell on ⇒ B gets one push for 3 quick messages; share card in the feed ⇒ Join; A removes B ⇒ B's composer turns read-only; "Feed | Groups" home with `homeLayout: "segmented"`.
- [ ] **Step 3: Web** (`npx expo start --web` in the example app): the same flow minus pushes; the "…" menu button and right-click; Realtime still live after the tab was hidden 2 minutes; image picking from a file.
- [ ] **Step 4:** Record the walkthrough (Argent, `argent-screen-recording`), compress (`ffmpeg -i in.mp4 -vcodec libx264 -crf 28 -vf scale=-2:1280 -an out.mp4`).
- [ ] **Step 5:** Open the PR with the recording attached (`gh pr create --attach ./walkthrough.mp4`, `![](./walkthrough.mp4)` alone on its line), read and resolve review threads.
