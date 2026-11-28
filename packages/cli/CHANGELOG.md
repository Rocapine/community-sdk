# @rocapine/community

## 0.22.0

### Minor Changes

- 9456d33: **Direct messages (new `dms` module).** One-to-one conversations on the messaging core, with the group chat's screen: text, one image, replies, likes, edits, deletes, on-demand translation, typing, report and block. A member starts one from a profile, a "new message" picker on the Messages page, or a post, comment or message menu (`dms.entryPoints`). "Message" opens the DM for its opener only: the other member hears of it with the first message, which runs the checks (their switch, blocks, the account rule, the day's budget) at that moment, and a DM nobody wrote in stays out of every list. With `dms.firstMessage: "requests"` a first message waits in the recipient's Requests (Accept / Decline / Block and report, the sender's context shown, nothing read until accepted); a decline is silent and the sender may keep writing, but the recipient never sees a declined request's messages again, and after `declineCooldownDays` the next message starts a new request. "Seen" under my last message with `dms.readReceipts` (never on a request). A member can turn DMs off in the profile edit sheet (that blocks new DMs only). Blocks apply to DMs: a blocked pair never reaches each other and neither side reads the DM's history; admins can't be blocked out, as in the feed.

  Pushes (push module): a DM message pushes the other member, a new request pushes once with a neutral line that names no one, and `messaging.pushPreview: "none"` now also drops the sender's name from a DM push's title. The member-wide switch is `notify_dms`. The center gets "your message request was accepted". Only the two members read a DM (its author never reads its cached translations, which would say it was read): the dashboard reads a message only through `admin_message_context`, for a reported or AI-hidden one. `messaging.onAccountDelete: "eraseDms"` and profile merge cover DMs (two DMs with one member become one). Everything is off unless the app sets `modules.dms`: an app that doesn't gets the same behaviour as before.

  - **Config:** `modules.dms` (`firstMessage`, `entryPoints`, `readReceipts`, `requireAccount`, `requestsPerDay`, `declineCooldownDays`; defaults `"direct"`, `["profile"]`, `false`, `false`, `5`, `30`). `messaging.*` now also applies with only `dms` on (`messagingSettings(cfg)` is non-null with groups or dms). `dms.requireAccount` needs a linked account on both sides and calls `host.onAccountRequired("dm")`. The backend enforces its own copy (`messaging_set_settings`: `dmsFirstMessage`, `dmsReadReceipts`, `dmsRequireAccount`, `dmsRequestsPerDay`, `dmsDeclineCooldownDays`): keep both equal (dev builds warn).
  - **Screens:** `MessagesScreen` gets the Conversations tab (Requests row, my DMs) and the pencil that opens the member picker, with an optional `onOpenRequests` (without it Requests opens inside the screen, and Android's back closes it); new `RequestsScreen` (`onOpenRequest`, `onBack`); `ConversationScreen` serves DMs (a first message refused because the member turned DMs off says so, new key `dms.error.dmsOff`; `account_required` calls `host.onAccountRequired("dm")`, or shows the line when the host has none); the `"dms"` header item (the Messages page on its Conversations tab, with the unread badge; "Direct messages" for screen readers, new key `a11y.dms`); `ProfileScreen` and `ThreadSheet` take `onOpenMessages` (no "Message" without it).
  - **Type changes that can break host code:**
    - `NotificationInboxScreen.onOpenMessages` now receives `{ groupId, preview? } | { conversationId }` (the DM of an accepted request): a callback typed for the group target only no longer type-checks. The feed's own `onOpenMessages` already took `conversationId`.
    - New optional `onOpenMessages?: (target: { conversationId: string }) => void` on `ProfileScreen` and `ThreadSheet`; the feed's callback fits.
    - `FeedHeaderItem` gains `"dms"`. The `resolveHeaderZones` util (not exported from the package index) takes a required `groups` flag and a `dms` flag: a dms-only app no longer shows a `"groups"` header item. With `homeLayout: "segmented"`, put `"dms"` in the header, not `"groups"`.
    - `AvatarPlacement` gains `"dm"` and `"dmHeader"` (a custom `renderAvatar` switching on it).
    - `InboxItem.kind` gains `"dm_request_accepted"`; `NOTIFICATION_PREFERENCE_KEYS` gains `notify_dms` (read and written only with `modules.dms` on, optional on `NotificationPreferences`).
    - The "Feed | Groups" selector is now the shared `SegmentedTabs`: its padding scales with a custom `theme.spacing` (identical at the default unit).
    - `COMMUNITY_EVENTS` gains `dmStarted`, `dmRequestAccepted`, `dmRequestDeclined`, `dmRequestBlocked` (ids only).
  - **Android:** the post and comment "…" menus open as a sheet (every action, a Cancel row, closed by back or a tap outside): the system alert showed three buttons at most and dropped Cancel once "Message" was added. iOS and web keep the system alert.
  - **Fixes:** on web, Enter in the chat composer sends and Shift+Enter adds a line (never while an IME composes, never an empty message; native keeps its return key as a newline); the chat composer sits right on the keyboard and keeps only the safe area the host left (a host padding the bottom, or a tab bar under the screen, left an empty band), and an emptied field is one line again on iOS; a sheet text field no longer throws on blur on web (`TextInput.State.currentlyFocusedInput` from gorhom's input); a blocked DM's row in the Messages list shows "You can't write to this member." and no count on both sides instead of the member's own older message; a DM channel the server refuses (a blocked DM) is no longer retried every few seconds, it rejoins when a block changes; a refused group channel retries after 12 s, doubling up to 5 min (`useMessages` and `useTyping` take an optional `{ dm }`); a removed member's open group screen offers Join again once readmitted (it re-reads the group every 30 s while the removed line shows: `useRefreshGroupOnFocus` takes an optional `everyMs`).
  - **Core exports:** `useStartDm`, `useDmRequests`, `useAcceptRequest`, `useDeclineRequest`, `useBlockAndReportRequest`, `useAcceptsDms`, `useSetAcceptsDms`, `usePeerRead`, `useMemberSearch`, `useDmFlags`, `dmFlagQueryOptions`, `dmsSettings`, and the `DmsConfig` / `DmsEntryPoint` / `DmSource` types.
  - **CLI:** new module `dms` (implies `messaging`; `init` without `--modules` installs it too, the app shows nothing until it sets `modules.dms`). Migrations `dms/001`–`009` (`005`: a request counts against `requestsPerDay` when sent; each member's private channel `dms:<id>` keeps the Requests row, the list and the badge live; `006`: the recipient's row comes with the first message, sending on a DM's channel needs read access, a block refreshes both members' lists; `007`: a DM nobody wrote in is gated like a new one even when both opened it; `008`: of two first messages sent at once in requests mode, the second is refused instead of landing in a request; `009`: the daily image sweep on an install without groups), no new function (`notify-message`, `report-to-slack` and `account-delete` handle DMs; `translate-message` now refuses a message's author, 403, before reading its cache, so its timing can't say whether a reader translated it: redeploy it). `npx @rocapine/community upgrade --add-modules dms`, `supabase db push`, `messaging_set_settings` for the `dms*` keys, then `supabase functions deploy`. Traps: a host that adds `push` after `dms` re-runs `messaging/002` then `dms/002`; one that adds `groups` after `dms` re-applies `dms/001` (`upgrade` copies it again). See `docs/backend-runbook.md`, section 8, and `docs/integration.md`, Direct messages.

- 43806fa: **Group chats (new `messaging` and `groups` modules).** Members create public groups, find them in Explore, preview them read-only, join, and chat: text, one image, replies, likes, edits, deletes, on-demand translation, typing, report and block. A group's card can be shared in the feed and joined from it. Moderation runs on messages (`messaging.moderation`: `"post"`, `"pre"` or `"reportOnly"`) and on each group's name, description and image before it is listed. Group pushes for the groups a member follows, several messages in a row pushed once; every community push's badge adds the unread messages of followed groups. The notification center gets "your group was approved", "part of your group wasn't accepted" and "you were removed from a group" (`NotificationInboxScreen`'s new `onOpenMessages`).

  Open chats stay current: a join, a leave or a removal refreshes the header's member count, and a member removed while the chat is open sees it at once (`groups/004_members_changed`). The daily sweep removes the files of deleted groups and abandoned chat uploads (`groups/005_storage_sweep`). Sends, edits and deletions of your own messages share one `ratePerMinute` budget (`messaging/006_rate_and_lock_order`, which also locks an edit in the same order as a send, so an edit and a reply to it can't deadlock), a group takes at most 5 edits an hour from its creator, a group under review takes messages from its creator only (a hidden or deleted one from nobody), and the sweep keeps every file an open report points at (`messaging/005_review_fixes`, `groups/006_review_fixes`). The report sheet now confirms inside the sheet on every platform (web had no confirmation), and the SDK's bottom sheets expose their fields and buttons to VoiceOver on iOS.

  In a chat, a double tap likes a message and a swipe right replies to it (iOS and Android; web keeps Reply in the menu); consecutive messages by one author group into a run (name on the first bubble, avatar and tail on the last); day separators read "Today", "Yesterday", the weekday, or the short date; replying shows the message's first line above the composer. Every "N online" is green with its dot and counts the other members only (`groups/007_online_others`); a chat's header shows just that, no member count. A host without the messaging module now makes one failing badge call per broadcast, not one per worker.

  Everything is off unless the app sets `modules.groups`: an app that doesn't gets the same behaviour as before.

  - **Config:** `modules.groups` (`preview`, `exploreLayout`, `shareCardLayout`, `requireAccount`, `createRequiresAccount`, `maxCreatedPerMember`, `maxJoinedPerMember`, `maxMembers`, `nameMaxLength`, `descriptionMaxLength`) and `messaging` (`moderation`, `translation`, `typingIndicator`, `badge`, `hubLayout`, `homeLayout`, `pushPreview`, `onAccountDelete`, `maxLength`, `ratePerMinute`); `host.onAccountRequired(reason)`. The backend enforces its own copy, set with `messaging_set_settings`: keep both equal (dev builds warn).
  - **Screens:** `MessagesScreen`, `ConversationScreen`, `ExploreGroupsScreen`, `GroupDetailsScreen`, `GroupMembersScreen`, `GroupFormSheet`; on `CommunityFeedScreen`, `onOpenMessages`, `onOpenExplore`, `beforeJoinGroup`, the `"messages"` / `"groups"` header items with their badge, and `messaging.homeLayout: "segmented"` for a "Feed | Groups" home.
  - **Type additions that can break exhaustive code:** `Group.creatorId` (`string | null`) and `Group.removed` (`boolean`: a manager removed me, the preview says so instead of offering Join) are required on hand-built `Group` objects; `AvatarPlacement` gains `"message"`, `"group"` and `"member"` (a host `renderAvatar` switching on it); `ChatMessage.status` includes `"hidden"` (the author's view of a message moderation hid); `InboxItem.kind` lists the three group kinds and `InboxItem` gains an optional `groupId`.
  - **Notification preferences:** `NOTIFICATION_PREFERENCE_KEYS` gains `notify_group_messages`, the member-wide "Groups" push switch (default on), through `useNotificationPreferences()`. It is read and written only with `modules.groups` on (`notificationPreferenceKeys(cfg)`); `NotificationPreferences.notify_group_messages` is optional. A host that maps over every key gets one more.
  - **New optional peer:** `expo-clipboard` adds "Copy" to a message's menu on iOS and Android (a native build); without it there is no Copy, and web uses the browser clipboard.
  - **CLI:** new modules `messaging` and `groups`; picking `groups` also installs `messaging` and `attachments` (the share card is a post attachment), and `init` without `--modules` now installs all three (the app shows nothing until it sets `modules.groups`). New functions `notify-message` (messaging + push) and `translate-message` (messaging + translation); `inbox/005_group_events` adds `notifications.conversation_id` and returns it from `list_notifications`; with the accounts module, `accounts/004_merge_hooks` makes a profile merge move the merged profile's memberships, messages, likes and groups too. Backend: `npx @rocapine/community upgrade --add-modules groups`, `supabase db push` (apply `messaging/002` before deploying `notify-message`; a host that adds `push` later re-runs `messaging/002_push.sql`), `messaging_set_settings`, then `supabase functions deploy`. See `docs/backend-runbook.md`, section 8, and `docs/integration.md`, Messaging.

## 0.21.10

### Patch Changes

- f3aaa9b: **Accounts: merged and deleted profiles are marked; a ban survives account deletion.** `accounts/003_markers_and_bans.sql` (no app change, needs core `021`):

  - `account_link_and_merge` sets `merged_into` on each profile it merges (and on any profile already
    merged into one of them), so the dashboard leaves merged profiles out of every count and list.
    A profile adopted again as the account's profile loses both markers.
  - `account_delete_profile` stamps `account_deleted_at`: a deleted account counts as a member until
    then, its posts always count.
  - Deleting a banned account no longer escapes the ban: `account_bans` keeps a keyed sha256 of the
    account's `provider:subject` (never the subject itself; the key, `account_ban_key`, is made once per
    database and readable by no API role), and the next profile that account links
    (a new link only: a later sign-in never undoes an unban) is banned, with a `ban` moderation action by `account ban`. `account_unban(profile)` (service
    role) lifts it; the dashboard's unban calls it. Deleting a profile that is not banned drops its
    account's leftover rows, so a ban lifted without `account_unban` doesn't come back.
  - Run `npx @rocapine/community upgrade` and `supabase db push`. `merge_profiles` is unchanged.
  - Release order: deploy the dashboard's brick 23 before accounts `003` reaches a host database (its
    unban calls `account_unban`; a ban lifted without it is still dropped when the profile is deleted
    again). A host that imported history with an importer that empties the placeholders members claim
    must set `merged_into` on those placeholders in the same push, right after core `021` (a host
    migration ordered after it), or they count as members.

- f3aaa9b: **Imported history counts in the dashboard's Activity.** `core/021_imported_history.sql` (no app change):

  - Placeholder profiles (a history import) now count like any member: their posts, comments, likes,
    poll votes and reactions show in Activity, and they count as contributors and active members.
    Expect higher numbers on apps that imported history.
  - A placeholder joins on its first post or comment (its creation date if it has none), not on the
    import date, so new members and members total read as if the community had been there all along.
  - Two markers on `profiles`, not client-writable: `merged_into` (a profile merged into another by
    the accounts module) and `account_deleted_at`. A merged profile is in no count; a deleted account
    counts as a member until its deletion and its content always counts. They stay empty until the
    accounts module sets them.
  - Moderation's team actions leave out the accounts module's automatic bans (`account ban`).
  - Indexes on `posts (author_id, created_at)`, `comments (author_id, created_at)` and
    `profiles (merged_into)`: a placeholder's join date is an index lookup.
    On a large production database, build the two author indexes beforehand with `create index concurrently if not exists` (and check they are valid), or push at low traffic with a `lock_timeout`: the file runs in one transaction.
  - Run `npx @rocapine/community upgrade` and `supabase db push`. Same function signatures and JSON
    shapes: the dashboard needs no change.
  - Release order: deploy the dashboard's brick 23 before accounts `003` reaches a host database (its
    unban calls `account_unban`; a ban lifted without it is still dropped when the profile is deleted
    again). A host that imported history with an importer that empties the placeholders members claim
    must set `merged_into` on those placeholders in the same push, right after core `021` (a host
    migration ordered after it), or they count as members.

## 0.21.9

### Patch Changes

- 924d444: **Accounts: a merged profile is signed out, a deleted account's badges and streak go.** `accounts/002_merge_and_delete.sql` (no change to 001):

  - `merge_profiles` revokes the merged profile's sessions (`auth.sessions`, refresh tokens cascade) and deletes its `push_devices` rows instead of moving them to the account profile, so nobody holding its old refresh token can keep acting as the emptied profile, and another device no longer receives the account's pushes. The device that signs in stays signed in: `account-session` mints its new session after the merge. As documented, call `registerPushDevice()` again after `accountSignedIn()`.
  - `account_delete_profile` (used by `account-delete`) also clears the profile's badges and streak (`badges`, `hidden_badges`, and the legacy streak columns where installed), so a deleted account's old posts stop showing them.

  Run `npx @rocapine/community upgrade` and `supabase db push`. No function to redeploy.

## 0.21.8

### Patch Changes

- ab985f5: **One community profile per app account (new `accounts` module).** An app with its own accounts sets `host.getAccountProof` (an Appwrite JWT, or any JWT checked against a JWKS) and calls `accountSignedIn()` / `accountSignedOut()` / `deleteAccountProfile()` from its auth flows: the member keeps the same profile on every device and after a reinstall, a second device's anonymous posts, comments and likes are merged into it, and deleting the app account resets the profile and signs out every device. `accounts: { required: true }` hides the community from signed-out users instead of giving them an anonymous profile. After each transition, `resetCommunityQueries(queryClient)` drops the previous profile's cached reads. The module is opt-in (`init` without `--modules` leaves it out). Backend: `npx @rocapine/community upgrade --add-modules accounts`, `supabase db push`, the `COMMUNITY_ACCOUNT_*` secrets, then deploy `account-session` and `account-delete` (keep `verify_jwt` on). Optional SQL hooks adopt the profiles members already have (`account_profile_candidates`, `account_owns_profile`, `on_account_linked`). See `docs/backend-runbook.md`, section Accounts.

  **Push on several devices.** `push/006_push_devices.sql` adds one push row per device (`push_devices`, keyed by the new `host.getInstallId()`); `registerPushDevice(cfg, token)` writes it (and the profile's `push_tokens` preferences row, without a token: apps must stop writing `push_tokens.expo_push_token` themselves) and the push functions send to every device of the member plus the legacy `push_tokens` token. Run `upgrade`, `supabase db push`, then redeploy `notify-like`, `notify-comment`, `notify-reaction` and `broadcast-post`.

## 0.21.7

### Patch Changes

- 271a0fb: Translation: styled Unicode text (𝐛𝐨𝐥𝐝, 𝚖𝚘𝚗𝚘…) is folded to plain letters (NFKC) before it is sent, so it no longer times out or comes back half untranslated. A call cut by OpenAI's content filter (it trips at random on some locales, e.g. the Lord's Prayer in Slovak) is split into one call per locale with a second try, instead of failing every locale of the item; incomplete responses are logged with their reason.

  Redeploy the functions that translate (`translate-one`, `daily-translation`, `notify-comment`, `broadcast-post`) after `upgrade`.

## 0.21.6

### Patch Changes

- db6a0bf: **Long posts get translated.** Translation asked for every target locale in one OpenAI call, capped at 90 s, so a long text never made it: a 2,000-character post in 19 locales timed out on every try and stayed untranslated. `translateItem` now splits the targets into parallel calls of at most 12,000 output characters each (text length × locales), then merges them. Redeploy the functions that translate (`translate-one`, `daily-translation`, `notify-comment`, `broadcast-post`) after `upgrade`.

## 0.21.4

### Patch Changes

- 1663191: **Poll limits per app.** Polls keep 2 to 4 options of up to 60 characters by default; an app can
  change the range.

  - Config: `modules.polls` takes `true` or `{ minOptions?, maxOptions?, optionMaxLength? }`.
    `pollLimits(cfg)` (core) returns the effective limits; the composer uses them. The
    `POLL_MIN_OPTIONS`, `POLL_MAX_OPTIONS` and `POLL_OPTION_MAX_LENGTH` constants stay, as the
    defaults.
  - Backend: `polls/002_poll_limits.sql` adds a one-row `poll_settings` and
    `poll_set_limits(min, max, max_length)` (service role; 2 ≤ min ≤ max ≤ 10, length 1 to 200),
    and `poll_limits()` for members. `create_poll_post` checks the option count against it, and the
    per-option limits move from check constraints to a trigger, so an importer can write history
    beyond them (`alter table public.poll_options disable trigger user`).
    `core/020_draft_poll_limits.sql` makes dashboard drafts follow the same limits.
  - To use another range, set both to the same values: the config, and once per Supabase project
    `select public.poll_set_limits(2, 7, 100);`. Run `npx @rocapine/community upgrade` and
    `supabase db push` first; nothing changes for apps that keep the defaults.

## 0.21.3

### Patch Changes

- b1dfa84: `moderate-one` and `update-profile` answer the browser's CORS preflight and send CORS headers, so a web build can call them. Before, every post published from the web stayed `pending` until the daily moderation sweep, and profile edits failed. Redeploy both functions after upgrading.

## 0.21.1

### Patch Changes

- 47df2d6: Two additive migrations for importing content from another platform. `core/018_content_length` (and `images/003_content_length`) moves the post and comment length limit from CHECK constraints to a trigger, so the limit applies to new writing only and an importer can bring in longer history (`alter table ... disable trigger user`). `core/019_placeholders` adds `profiles.is_placeholder`: placeholder profiles for imported authors show like members but are left out of the dashboard counts. Run `npx @rocapine/community upgrade` and `supabase db push` to pick them up; nothing changes for existing data.

## 0.21.0

### Minor Changes

- 6cb46bf: Community pushes (comment, reply, like, reaction) have built-in copy in all 23 locales `@rocapine/community-ui` ships, instead of 9: adds `fr-vous`, `ko`, `ro`, `uk`, `nl`, `ru`, `el`, `hu`, `sv`, `nb`, `da`, `hr`, `sk` and `cs`. Russian, Croatian, Czech and Slovak counts now pick their own plural forms (before, any locale without built-in copy used the English rule, even when `COMMUNITY_PUSH_COPY` overrode its strings), and a `no` profile locale gets the Norwegian copy. Reinstall the functions with the CLI and redeploy `notify-comment`, `notify-like` and `notify-reaction` to pick it up.

## 0.20.0

### Minor Changes

- 577d15f: **The dashboard's Activity numbers.** One new migration template that fixes and extends
  `admin_daily_metrics`, which the community dashboard reads. Nothing changes in the app.

  - `core/017_activity_metrics.sql`: `admin_daily_metrics(from_date, to_date, tz)` takes the
    team's time zone (an IANA name, `UTC` when left out; anything else raises `invalid_time_zone`)
    and counts days in it. What changed in meaning:
    - House accounts are out of every count, posts, comments and topics included.
    - Reply rate: a reply is a comment that isn't deleted, by someone other than the post's
      author, within 24 h; a team reply counts. Posts under 24 h old are left out, so the end of a
      period isn't pulled down. It now comes per day (`replied_24h`, `reply_eligible`).
    - New posters: a member's first post that isn't deleted.
    - New keys: likes, poll votes and reactions per day (`null` without the polls / reaction
      module), contributors per day, unanswered posts, contributors, reactors and contributors by
      number of posts and comments.

  Migration: no app change. `npx @rocapine/community upgrade`, then `supabase db push`.

## 0.18.0

### Minor Changes

- 7b2c58a: **Online presence.** A green dot on a member's avatar while they are in the app, and an
  "online" header item with the live count.

  - Backend: the `presence` module (`npx @rocapine/community init|upgrade --add-modules
presence`). Online means in the foreground within the grace window, a per-project backend
    setting (default 5 minutes, `select public.presence_set_grace_minutes(10);` as service
    role) that clients cannot pass, so no one can probe when a member was last active. RPCs
    never return a timestamp. Hidden members still count, and blocked members never see each other's dot.
  - Core: `modules.presence: { minCount?, collapseAfterMs? } | false`,
    `startPresenceHeartbeat(cfg, AppState)` (the host runs it; it never signs in anonymously),
    `touchPresence`, `presenceSettings`, hooks `useOnlineCount`, `useIsOnline`,
    `usePresenceVisible`, `useSetPresenceVisible`, event `community_presence_visibility_changed`.
  - UI: the `"online"` feed header item (dropped when the module is off), the dot on post,
    comment and profile avatars (drawn around a custom `renderAvatar` too, which also receives `AvatarRenderProps.online`; the new `"blocked"` placement is the blocked-members list, with no dot), and an
    "Activity status" switch in the profile edit sheet.

## 0.17.0

### Minor Changes

- 6dafb63: **A block now works both ways, and can be undone.** Until now, when A blocked B, A stopped
  seeing B but B still saw A, and could comment and reply under A's posts: everyone saw it
  except A, who could not report it.

  - `core/016_mutual_blocks.sql`: neither member sees the other's posts, comments, likes or
    profile, and neither can comment, reply or like on the other's content. A comment or a like
    now needs a post the member can read (no more commenting a hidden post by id). Admins are
    never hidden by a block and can't be blocked. `blocked_member_ids()` is the one rule; reuse
    it for anything that shows one member to another (online presence included).
    `list_blocked_members()` lists whom I blocked.
  - `inbox/004_mutual_blocks.sql`, `reaction/004_mutual_blocks.sql`: the notification center and
    the reaction summary hide members blocked either way, past items included; an unblock
    brings them back. The likes, comments and reactions pushes and the icon badge follow the
    same rule.
  - Core: `unblockUser`, `fetchBlockedMembers`, `isProfileUnavailable`, hooks `useUnblockUser`,
    `useBlockedMembers`, event `userUnblocked` (`user_unblocked`).
  - UI: `BlockedMembersScreen` (mount it from your settings); a blocked profile shows "This
    profile isn't available", with Unblock for the member who blocked; a harassment report offers
    to block the author; no Block item on an admin's posts; the block confirmation says it works
    both ways. All 13 locales.

  Migration: `npx @rocapine/community upgrade`, `supabase db push`, redeploy `notify-comment`,
  `notify-like` and `notify-reaction`. Installed app versions get the mutual block without an
  update; on them a blocked profile shows their usual error state.

### Patch Changes

- 36d6e90: **An admin broadcast sets each member's real unread count on the app icon.** `broadcast-post`
  used to set the badge to 1 for everyone, whatever the member had left unread. It now sends each
  member their own count, and every push badge (likes, comments, reactions, broadcasts) counts the
  admin posts sent to everyone, as the notification center does.

  Migration: redeploy `broadcast-post`, `notify-comment`, `notify-like` and `notify-reaction`
  (`supabase functions deploy`). No database change.

## 0.16.0

### Minor Changes

- ca73e9e: **Post drafts for the community dashboard.** Two new migration templates, used by the
  dashboard to keep posts as drafts shared by the whole team and to publish them as a team
  account. Nothing changes in the app.

  - `core/014_post_drafts.sql`: a `post_drafts` table and `publish_post_draft`, which publishes
    a draft as its author. Service role only: no RLS policy, so the app never sees a draft.
    Pinning and notifying everyone need an admin author, enforced in `publish_post_draft`.
    Image-only drafts may have empty text, as posts do in the app.
  - `images/002_draft_images.sql`: the images module keeps the images of drafts, and the
    nightly sweep no longer deletes them.

  Migration: no app change needed. Run `npx @rocapine/community upgrade`, then
  `supabase db push`, to get the tables if the community dashboard manages this community.

- 9506493: **Scheduled posts for the community dashboard.** One new migration template, used by the
  dashboard to publish team drafts at a chosen time. Nothing changes in the app.

  - `core/015_scheduled_posts.sql`: a pg_cron job publishes due drafts every minute through
    `publish_post_draft`, as the draft's team account; the moderation log names whoever
    scheduled it. `schedule_post_draft` lets the dashboard plan a time on a draft (not yet armed,
    the post need not be complete), arm it (the whole post is validated, only armed drafts are
    published) or clear it. A draft more than 30 minutes late is not published and is marked `missed`.
    A transient database error (deadlock, serialization failure, lock timeout) is retried on the
    next run. Event topics can carry a date window (`topic_from`, `topic_until`): a draft
    scheduled outside it is refused with `topic_closed`.

  Migration: no app change needed. Run `npx @rocapine/community upgrade`, then
  `supabase db push`, to get the job if the community dashboard manages this community.

## 0.15.0

### Minor Changes

- b69bf37: **Admins pin and notify everyone from the composer.** An admin's composer shows two
  options above the toolbar: "Pin" (`composer.pinPost`) pins the post once it is created,
  and "Notify everyone" (`composer.notifyAll`, push module only) pushes it to every member
  once it is published, also when moderation publishes it later. `CreatePostVariables`
  takes `pin` and `notifyAll`; core exports `requestPostBroadcast()`.

  `adminPostsNotifyAll` (default false): every admin post notifies everyone, and the
  composer drops the "Notify everyone" option.

  `maxPinnedPerTopic` (default 1) caps the pinned posts of a topic. Pinning one more, from
  the composer or a post's `…` menu, shows a warning (`pin.limitTitle` / `pin.limitBody`)
  and pins nothing; core exports `countPinnedPosts()`.

  **The notification center lists what was pushed.** An admin post appears in the center
  only once it was sent to everyone, dated when it was sent; admin posts that were never
  pushed leave it, also for app versions already installed. The broadcast never reaches
  the author's own devices, and a post goes out once.

  Backend: `core/013_post_broadcasts.sql` (`posts.broadcast_requested`,
  `posts.broadcast_at`, `request_post_broadcast()`, admins only),
  `push/005_broadcast_trigger.sql` (sends once the post is visible) and
  `inbox/003_pushed_admin_posts.sql`. `broadcast-post` accepts the service role, or the
  trigger for a post its admin author asked to send. Run
  `npx @rocapine/community upgrade`, `supabase db push`, then redeploy `broadcast-post`.

- 6672084: **Admins pin posts from the app.** An admin's `…` menu on a post offers "Pin" or
  "Unpin" (`post.pin` / `post.unpin`). Pinned posts lead "All" and their topic, newest pin
  first, until unpinned. Through `set_post_pinned` (`core/012_pin_posts.sql`), which
  refuses anyone but an admin; `usePinPost()` / `setPostPinned()` in core. Run
  `npx @rocapine/community upgrade` and `supabase db push`.
- 6092dbb: **Admin accounts and admin-only topics (breaking).** "Official" accounts are now called
  admin accounts everywhere, and any topic can be reserved for them, not only `news`.

  - Everyone reads an `adminOnly: true` topic. On its tab a member gets no `+` and never
    sees it in the composer; an admin gets the `+`, with that topic preselected. Its tab
    leads with the `announcement` icon, and its empty state reads `feed.adminTopicEmpty`.
  - The database no longer reserves `news` (`core/011_admins.sql`): which topics are
    admin-only is the app's config, applied by the UI.

  Migration:

  - Run `npx @rocapine/community upgrade`, then `supabase db push`. `profiles.is_official`
    becomes `is_admin`; a read-only `is_official` copy stays for app versions on 0.14 or
    older, and the inbox still names admin posts `official_post` for them (0.15 reads
    both). Make an account admin with `update profiles set is_admin = true where id = …`.
  - Renames: `CommunityTopicDef.officialOnly` → `adminOnly`, `isOfficialTopic` →
    `isAdminTopic`, `FeedPost`/`ThreadComment.authorOfficial` → `authorAdmin`,
    `CommunityProfile.official` → `admin`, the `renderAvatar` prop `official` → `admin`,
    the inbox kind `official_post` → `admin_post`, the icon `officialSeal` → `adminSeal`,
    the colors `official`/`officialName` → `admin`/`adminName`, the string
    `feed.newsEmpty` → `feed.adminTopicEmpty`, and `broadcast-post`'s push data kind
    `community_official_post` → `community_admin_post`.
  - `composeTopics(admin?)` now takes whether the author is an admin.

- 05caa2d: Attachments. A post can carry one reference to the app's own content (`{ type, id }`: a
  verse, a recipe, a session), never a URL: each reader's app draws the card from its own
  data with `renderAttachment(attachment, { placement, open })` and opens it with
  `onOpenAttachment` (both on `CommunityUIProvider`). Configure it with
  `modules.attachments: { types, membersCanAttach }`; official accounts can always attach.
  Share from the app with `CommunityFeedScreen`'s `composeRequest`
  (`{ attachment?, text?, requestedAt }`): the composer opens with the card, through the same
  gates as `+`. A post carries an attachment, a poll or a photo, never two, and still needs
  text (pass `text` in the request to pre-fill it).

  New backend module `attachments` (`posts.attachment`, shape and size checked).
  Core: `createPost({ attachment })`, `FeedPost.attachment`, `canAttach`, `PostAttachment`.
  UI: new string `composer.removeAttachment`.

- 093fc9f: **Member badges (breaking).** The streaks module becomes a generic badges module: each
  app declares its badges (`modules.badges: { [id]: { placements } }`, placements `post`,
  `comment`, `profile`), computes their data on the device (`host.getBadges()`), and draws
  them with `renderMemberBadge({ id, data, placement, size })`. Each badge gets its own
  visibility toggle in the profile sheet; a hidden badge never leaves the database.
  `STREAK_BADGES` + `streakBadgeData()` reproduce the streak (current streak on posts and
  the profile, best streak on the profile) with the built-in pills.

  New backend module `badges` (`profiles.badges`, `hidden_badges`, generated
  `visible_badges`). `streaks/002_to_badges` moves an existing streak install over and keeps
  the legacy columns in step both ways, so app builds still on the streaks API keep working;
  a later `streaks/003` drops them.

  Migration:

  - DB: `npx @rocapine/community upgrade` brings `badges/001` and `streaks/002` to an install
    that has streaks (badges first); push them before shipping the new client.
  - Config: `modules.streaks: true` → `modules.badges: STREAK_BADGES`;
    `host.getStreak: () => s` → `host.getBadges: () => streakBadgeData(s ?? { startedAt: null, bestDays: 0 })`.
  - UI: `renderStreakPill` → `renderMemberBadge` (`id` is `streak` or `bestStreak`; the day
    count is `streakDays(data.since)` or `data.days`; the old `tier` is `streakTier(days)` and
    `label` is `useT()("streak.days", { count: days })`; `defaultMemberBadge(p)` draws the
    built-in pill). `StreakPillRenderProps` is gone. The renderer is called as a plain
    function: no hooks in it, return an element.
  - Data: `FeedPost.authorStreakStartedAt` → `authorBadges`; `CommunityProfile`
    `streakStartedAt` / `bestStreakDays` / `showStreak` / `showBestStreak` → `badges` /
    `hiddenBadges`; `ThreadComment.authorBadges` is new. Raw rows: `PostRow.author_streak`
    (`{ visible_streak_started_at }`) → `author_badges` (`{ visible_badges }`), and
    `buildFeedSelect`'s fifth argument `streaks` → `badges`.
  - `setStreakVisibility` / `useSetStreakVisibility` → `setBadgeVisibility` /
    `useSetBadgeVisibility({ key, visible })`.
  - Strings: `profile.streak` → `badge.streak.label`, `profile.bestStreak` →
    `badge.bestStreak.label`, `profile.showStreak` → `badge.streak.toggle`,
    `profile.showBestStreak` → `badge.bestStreak.toggle`, `profile.streakHelper` →
    `profile.badgesHelper` (now generic copy); new `profile.badges` (the toggles' header).
    Rename your overrides. A badge's switch reads `badge.<id>.toggle`, else its
    `badge.<id>.label`, else its id.
  - `renderAvatar` now receives the member's `badges`.

## 0.14.0

### Minor Changes

- f8e5abd: Streaks module (`modules.streaks`, `streaks/001_streaks.sql`): the host's streak on each profile, mirrored from `host.getStreak` by `syncProfileFromHost`. A bronze / silver / gold pill (under 30 days, 30 to 90, beyond 90; theme `streakBronze`/`streakSilver`/`streakGold`, icon role `streak`) sits under the author's name on posts, the profile shows the streak and the best streak, and the owner's edit sheet has two toggles (`useSetStreakVisibility`). A hidden value never leaves the database: readers only see generated `visible_*` columns.

  `PostSlots.onPressReaction`: a tap on the reaction calls the host instead of toggling (e.g. open a flow that reacts at its end with `useReactToPost`).

  `CommunityPost` `preview`: a read-only quote of the post (a small avatar beside the author line, three lines full width below with View more; no streak, menu, footer, image or poll), for a host's own reaction sheet.

  Every community sheet now opens to the same height, right under the status bar / Dynamic Island (`snapTo="full"` is 100% below the top inset; the rules and report sheets use it too), and still pans down to close. A tap on a post's streak pill opens the author's profile. The profile sheet's streak toggles sit under the bio, with room above Save, and stay visible in both themes.

  Fix: the feed's topic tabs no longer scroll vertically (the slot's hairline border ate into the row's height).

## 0.13.0

### Minor Changes

- d64bea8: Flat, X-style community screens (EVR's design). Relative timestamps now count seconds, months and years (`timeAgoParts` gains the `second`, `month` and `year` units; `time.seconds`, `time.months.*` and `time.years.*` in every locale), and a label under a minute old ticks every second.

  **community-ui (breaking).** The feed, the in-community profile and the notification inbox drop their cards for flat, full-width rows: the avatar in a first column, `name › topic · time` on one line with the `…` menu at its end (the `@handle` stays on the profile), and "View more" at the end of a body's last visible line. Topics are scrollable tabs, and `headerLayout.title` takes an image (`{ image, position?, accessibilityLabel? }`) for an app logo.

  - **Composer.** `ComposerCard` and the floating compose bar are removed (export gone). A `+` button opens the new full-screen `ComposerSheet` (exported). `beforeSubmitPost` is replaced by **`beforeCompose: () => Promise<boolean>`**, awaited on the `+` tap after the rules and before the composer opens. Migration: pass your post gate as `beforeCompose` (it no longer receives a draft).
  - **Topics.** Tapping a post's topic selects its tab in the feed (and from its search and thread). `ProfileScreen` and `ThreadSheet` take `onPressTopic(topicId)`; the feed takes `topicRequest: { topicId, requestedAt }` so a host can land on a topic from elsewhere.
  - **Avatars.** `CommunityUIProvider` takes `renderAvatar({ userId, name, url, size })`, used by every avatar the SDK draws; `Avatar` is exported. The default is unchanged.
  - **Feed chrome.** The top bar (header and topic tabs) hides as the reader scrolls down and comes back on the way up. `bottomChrome: { height, hidden }` lets a host's floating tab bar hide in step (the feed writes `hidden`, a Reanimated shared value, from 0 to 1); the `+` button rides on it.
  - **Comments.** Comments can be liked and replied to, one level deep under their root comment ("Replying to @handle" above the field). New icon roles `reply` and `markAllRead` — a host that types a complete `CommunityIconSet` must add them (at runtime a missing role falls back to the default).
  - **Posts from outside.** The feed takes `postRequest: { postId, requestedAt }` to open a post's thread, e.g. from a tapped push. `ThreadSheet` loads a post no list has loaded yet.
  - **Inbox.** With `inboxReadMode: "tap"` a row is read once tapped (unread rows are marked), and the header offers "Mark all as read" (disabled when nothing is unread). Rows for replies read "{name} replied to your comment".
  - **Web.** "View more" is cut from the browser's real lines and sits inline like on native; multiline fields size to their text; no focus ring on fields; the composer's topic menu and date column work on react-native-web.
  - New strings in all 13 catalogs: `composer.cancel`, `composer.discardTitle`, `composer.discard`, `composer.keepEditing`, `feed.compose`, `time.seconds`, `time.months.*`, `time.years.*`, `thread.replyingTo`, `a11y.like`, `a11y.reply`, `a11y.cancelReply`, `inbox.replied`, `inbox.markAllRead`.

  **community-core.** `CommunityConfig` gains `postMaxLength` (default `DEFAULT_POST_MAX_LENGTH`, 500; capped at the database's `POST_MAX_LENGTH`) and `inboxReadMode: "open" | "tap"` (default `"open"`, unchanged behavior). New: `useCreateComment` takes `parentId`, `setCommentLike` / `useToggleCommentLike`, `fetchPost` / `usePost`, `markInboxItemRead` / `useMarkInboxItemRead`, `isUnread`, and `useMarkPostNotificationsRead()(postId, kind?)`, which marks a post's unread inbox items read (call it when a push about the post is tapped). The inbox refetches every 2 minutes while the app is open.

  **Backend.** Run `npx @rocapine/community upgrade`, then push the new migrations (`core/010_comment_threads`: `comments.parent_id` and `comment_likes`; `inbox/002_replies_and_reads`: `reply` notifications and `notification_reads`) and redeploy `notify-comment`, `notify-like`, `notify-reaction` and `broadcast-post`. Both migrations are additive, safe for installed app versions. A reply now notifies only the author of the comment it answers (push `community_reply`, new copy key `reply.title`), no longer the post's author. Every community push carries the post's id: `data: { route: "/community", kind, postId }`. The push badge no longer counts items read one by one.

## 0.12.0

### Minor Changes

- 09f776d: Default names, and an editable display name and handle.

  - Every profile now starts as "<label> <digits>" / `@<handle>-<digits>` ("User 4821" / `@user-4821` by default), assigned on the first launch in the user's language. **Breaking:** `anonymousAuthorFallback` is replaced by the optional `defaultName: { label, handle }` (`label` may be a function of the host locale).
  - The app's name (`host.getDisplayName()`) seeds the profile and keeps following it, until the user edits their name in the community; then the user's edit wins. The handle follows the app's name the same way until the user picks one.
  - Edit profile: new display name field; the handle field is labelled "Handle" and a taken handle comes with a free suggestion the user can take in one tap. Names and handles containing the app's name (`COMMUNITY_APP_NAME`) are refused, as are a few staff handles.
  - `resetProfileIdentity()` puts the default name and handle back for account deletion.
  - Backend: run `npx @rocapine/community upgrade`, then push the new migration (`core/009_default_names`) and deploy `update-profile` and `daily-moderation`.

## 0.11.0

### Minor Changes

- 84c5b85: Images in posts and comments (opt-in module `images`).

  core: `modules.images: true`. One photo per post and per comment, alone or with text; a post carries a poll or an image, never both. `useCreatePost` / `useCreateComment` take a `LocalImage` and upload it with `uploadPostImage` (public `post-images` bucket, `POST_IMAGES_BUCKET`); the lower-level `createPost` / `createComment` take its result, an `UploadedImage` (`{ path, width, height }`, now exported); optimistic items show the local file until the refetch. `FeedPost.image` and `ThreadComment.image` (`PostImage | null`, `mapImage`). `postPublished` and `commentPublished` gain `hasImage`. BREAKING (types) for hosts that build `FeedPost` / `ThreadComment` literals by hand: add `image: null`.

  ui: composer Image button next to the topic select (hidden while a poll is open), thumbnail with a remove button; feed image inside the card (rounded, aspect kept, 4:5 cap, 1.91:1 floor, final frame before load); full-screen viewer (pinch and double-tap zoom, swipe down to close; inside a thread it is an overlay within the sheet — a host rendering `CommunityPost` in its own `CommunitySheet` must not wrap it in `ImageViewerHost`); comment images at most 60% wide; the reply-bar avatar becomes the add-image button while the field is focused; inbox rows for image-only items read "📷 Photo" (new strings in all 13 catalogs). New icon role `image` — a host that types a complete `CommunityIconSet` must add it (at runtime a missing role falls back to the default); the composer's Poll toggle now carries `accessibilityRole` / `accessibilityState`. Requires `expo-image-manipulator` (native module ⇒ new build): photos are re-encoded on device (JPEG 0.8, long edge ≤ 1600 px), which strips EXIF/GPS; without it the image buttons are hidden and a dev build warns once.

  cli: new module `images` (`images/001_images.sql`: columns, the `post-images` bucket — 2 MB, JPEG only, own folder — and the sweep RPC) and `translation/003_skip_empty.sql` (the translation sweep skips image-only items). Upgrade: `npx @rocapine/community upgrade --add-modules images`, `supabase db push`, redeploy the functions.

  functions: an item with an image gets a text call (normal rules) and an image-only call (strict: `MODERATION_EXCLUDED_CATEGORIES` never applies to images); lookup errors fail closed. BEHAVIOR CHANGE: avatars are moderated strictly the same way, so apps that set `MODERATION_EXCLUDED_CATEGORIES` get stricter avatar checks. A hidden item keeps its file (dashboard restore works); an item whose verdict includes `sexual/minors` and that carries an image has its file deleted at once; files of author-deleted items and unreferenced uploads are removed by `daily-moderation` once older than 24 h. Pushes and inbox read "📷 Photo" for an image-only item (new push copy key `photo`, overridable through `COMMUNITY_PUSH_COPY`); Slack reports include the image URL. The moderation dashboard is unchanged (text only).

## 0.10.2

### Patch Changes

- edd3e07: `init` records only the function files it copies in `community-sdk.json`. A host file already present in an SDK function folder (e.g. `supabase/functions/_shared/<your-dir>/`) was listed too: `init`'s rollback on error would delete it, and since 0.10.1 `upgrade` would remove it as a file the SDK no longer ships. If your manifest's `installedFiles` lists any of your own files, remove those lines before running `upgrade`.

## 0.10.1

### Patch Changes

- 4e7e660: `upgrade` no longer deletes the host's own files inside an SDK function folder (e.g. `supabase/functions/_shared/<your-dir>/`). It now overwrites only the files the template ships, removes only files an earlier SDK version installed (per `community-sdk.json`) that the template dropped, and ignores host files when deciding whether a function changed. 0.10.0 wiped such folders: if you ran `upgrade` with it, check `git status` for deleted files under `supabase/functions/` and restore them.

## 0.10.0

### Minor Changes

- 25eafa4: UI/UX pass.

  core: the secondary reaction can be withdrawn — `useReactToPost().mutate({ postId, on: false })`, `setReaction(cfg, postId, on)`, `applyReaction(post, on)`.
  ui: buttons with a visible surface use `PressableScale` (0.98 scale-down, no opacity, no spring); so do the post's like / reaction / comment buttons; other icon buttons and links stay plain; opening a thread blurs the composer; haptics only on choices and commits (like, reaction, vote, publish, send); the post card isn't tappable inside its own thread; pull-to-refresh spinner only for a pull; the default reaction button toggles; fixed-width stats with tabular digits; the comment button opens the thread with the reply field focused (`ThreadSheet` `focusComment`, `CommunityPost` `onPressComment`); filter chips scroll edge to edge; 44pt header icons; search bar and chips share one height; no composer while searching, plus a clear button; room under the last post for the floating compose bar; the composer drops its topic chips — it grows while composing and shows a topic select (defaults to the browsed topic); bold Publish label and a visible disabled state; four radii, concentric nesting. Theme: `colors.reaction`, `fontWeights`.
  cli: ships `reaction/003_retract.sql` (delete policy on `post_reactions`) — run `community upgrade` then `supabase db push`.

## 0.9.0

### Patch Changes

- 8bef3bd: - core: `useNotificationPreferences()` (push module) reads and updates the caller's `notify_likes` / `notify_comments` / `notify_reactions` flags with optimistic updates; `fetchNotificationPreferences` / `setNotificationPreference` underneath. `useCommunityUnseenCount(lastSeenAtIso, { enabled })` — `enabled: false` keeps a host's kill-switch arm from creating the identity or polling.
  - ui: icon-only buttons (inbox bell, back, overflow menus, comment send) carry `accessibilityRole` / `accessibilityLabel` (new `a11y.*` keys in every catalog). **Default icons move to expo-symbols** (SF Symbols on iOS, Material Symbols on Android/web). BREAKING for hosts that relied on the previous defaults: `npx expo install expo-symbols` (optional peer, native module ⇒ new build) or pass a complete `icons` set. The previous icon dependency is no longer referenced anywhere.
  - functions: `notify-*` send the recipient's real unread inbox count as the push `badge` (`unreadBadge`; 1 when the inbox module is absent) so the app icon badge means something. `COMMUNITY_TRANSLATION_STYLE` may be a JSON object of per-locale hints (`{ "fr": "address the reader as vous" }`), applied per target locale.
  - migrations: `push/004_delete_own_push_row.sql` — a user can delete their own `push_tokens` row (account deletion); `community upgrade` copies it, then `db push`.

## 0.8.1

### Patch Changes

- e5ce99a: `update-profile` accepts `username` (the display name, 2–24 characters) and moderates it like the handle; `updateProfile({ username })` / `useUpdateProfile` pass it through. Hosts that let the user choose a pseudonym can now route it through moderation instead of writing `profiles.username` directly. `community upgrade` updates the function.

  The feed composer and the comment composer now read `host.getDisplayName()` after the `beforeSubmitPost` / `beforeSubmitComment` gate, so a pseudonym chosen inside that gate stamps the optimistic post instead of the fallback name.

- 2ac9411: Edge Functions: a rejected Expo push (HTTP error such as `UNAUTHORIZED` when the Expo project has push security enabled and `EXPO_ACCESS_TOKEN` is unset, or an error ticket such as `DeviceNotRegistered`) is now logged with `console.error` instead of being swallowed. The templates also ship the `ro` / `uk` plural rule for the push copy that landed with the UI catalogs (#25) — `community upgrade` then updates `_shared/copy.ts` and `_shared/push.ts`.

## 0.6.0

### Minor Changes

- 9e0fa68: The migrations no longer carry the project URL / anon key. The pg_cron jobs and pg_net webhooks read them from Supabase Vault through the helpers in the new `core/000_settings.sql`, and the webhook functions, triggers and jobs move into `core/008_webhooks`, `push/003_webhooks`, `reaction/002_webhooks` and `translation/002_webhooks`. One `supabase/` folder now deploys unchanged to a sandbox and to production; what differs is one statement per project, run once after `db push`: `select public.community_settings_set('https://<ref>.supabase.co', '<anon key>')`. An unseeded project logs a warning per webhook instead of blocking inserts, and the daily sweeps catch up. `init` / `upgrade` stop prompting for and substituting anything; `--project-url` / `--anon-key` only fill in the printed seed statement. Existing installs: `upgrade`, `db push`, seed.

## 0.4.1

### Patch Changes

- c9797a1: `init --help` / `adopt --help` list the `translation` module alongside the others.

## 0.3.3

### Patch Changes

- 2ac6583: The OpenAI translation timeout scales with text length and target count (20 s + 5 ms per character per locale, capped at 90 s): long posts no longer time out on every attempt.

## 0.3.2

### Patch Changes

- c5ba4aa: A failed translation marks its claim so pushes waiting on it send immediately instead of after 20 s.

## 0.3.1

### Patch Changes

- 28a21d3: broadcast-post pages through push_tokens (PostgREST max_rows no longer caps official broadcasts at 1000 devices); comment pushes and broadcasts wait up to 20 s for an in-flight translation instead of sending the source language.

## 0.3.0

### Minor Changes

- 4f83d20: New `translation` module: `translation/001_translations.sql`, `translate-one`, `daily-translation`; `notify-comment` and `broadcast-post` send excerpts in the recipient's language; secrets `COMMUNITY_TRANSLATION_LOCALES` (required), `COMMUNITY_TRANSLATION_MODEL`, `COMMUNITY_TRANSLATION_STYLE`.

  - `upgrade --add-modules <modules>` installs a module (e.g. `translation`) on an already-initialized backend, without re-running `init`.
  - Deno test files (`*_test.ts`) are no longer shipped in the templates nor copied into a host's `supabase/functions/`; `upgrade` ignores a host's existing copy when diffing (and drops it when it re-syncs that function).
  - A plain `upgrade` (no `--add-modules`) keeps the manifest's `modules` list as it is.
  - Optional secret `COMMUNITY_TRANSLATION_SWEEP_BATCH` (items per kind per `daily-translation` run, default 250).

- 38e13ec: - New core template `core/007_username_moderation.sql`: `profiles.username` (client-writable, never moderated) is now checked by the daily sweep — flagged names are blanked and remembered so a client re-sync keeps them blank. Additive (two nullable columns + a trigger); `npx @rocapine/community upgrade` installs it.
  - `daily-moderation` sweeps usernames (up to 1000 per run), lists blanked names in the Slack summary, and stays quiet (no API call, no Slack post) when there is nothing to check — so a stray anon-key call is free.

## 0.2.0

### Minor Changes

- bce9b4a: Backend function templates (`npx @rocapine/community upgrade` redeploys them):

  - `notify-comment` and `report-to-slack` no longer trust the trigger body: they re-read the row by id (and `notify-comment` requires it to be visible). Previously anyone holding the anon key could push arbitrary text to any post author under any name.
  - `moderate-one` only accepts the row's author (user JWT) or the service role, and every status write in `moderate-one` / `daily-moderation` is guarded on the status it read, so a post deleted mid-moderation is never resurrected.
  - `moderate-one` / `daily-moderation` query `poll_options` separately and tolerate its absence (core-only installs no longer 400 the daily sweep).
  - Locale-aware push copy for comments/likes/reactions in 9 locales (`profiles.locale`), overridable per locale and per key through the new `COMMUNITY_PUSH_COPY` JSON secret — an app keeps its own voice without forking the functions. `COMMUNITY_FALLBACK_NAME` / `COMMUNITY_REACTION_PUSH_TEXT` still work as legacy single-string overrides.

## 0.1.0

### Minor Changes

- initial public release
