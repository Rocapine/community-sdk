# Messaging: direct messages and public group chats

Status: draft for approval (27 Nov 2026).

## Why

The feed lets members talk to everyone at once. Members also want smaller circles: a
one-to-one conversation to help someone personally, and groups around what they share
(a city, a parish, a country, a common struggle). Messaging adds both, on the same
backend, moderation, translation and identity as the feed.

## Goals

- **Direct messages (DMs)** between two members, opt-out per member (on by default).
- **Public group chats**: any member can create one (name, description, optional image),
  find it through search, preview it read-only and join it in one tap.
- **One chat experience for both**: bubbles, likes, quoted replies, edits, deletions,
  images, app attachments, live delivery, typing indicator.
- **Moderated and translated** like the rest of the community, with the moderation mode
  chosen by the app.
- **Generic.** Every behaviour below is a config option with an SDK default; the host app
  sets its own values. Nothing in the SDK knows about a particular app.

## Non-goals

- No private or invite-only groups: every group is public and searchable.
- No group categories, no group roles beyond creator / member (app admins stay app-wide).
- No voice, video, files other than images, or message reactions other than one like.
- No end-to-end encryption: messages are readable by the backend, which moderates them.
- No threads inside a chat: replies quote a message, they do not branch.
- The community dashboard's messaging screens are a separate project (see "Dashboard").

## Anti-goals

- A DM must never be readable by anyone but its two members, except by an app admin
  looking at a message that was reported or hidden by moderation, and only around it.
- A member must never be reachable by someone they blocked, or who blocked them.
- An unsolicited DM must never notify the recipient with its sender or content when the
  app asks for neutral pushes, and must never reveal to the sender that it was read before
  it is accepted.
- A group's name, description or image must never be visible to anyone but its creator
  before moderation approved it.

## Delivery

Three slices, each released on its own:

1. **Shared chat core** — conversations, messages, likes, replies, edits, deletions,
   images, attachments, Realtime, typing, moderation, on-demand translation, the Messages
   page, the header items and the badge. Shipped with groups (nothing uses it alone).
2. **Groups** — creation, moderation of the group's metadata, explore and search,
   read-only preview, membership and its limits, creator powers, per-group notifications,
   the "join the group" attachment.
3. **DMs** — opt-out, entry points, requests, read receipts, account requirement.

The host app's integration follows each SDK slice. Shipping the feature to members comes
first: neither slice waits for the dashboard, which is built in parallel or right after
(see "Dashboard").

### Platforms

iOS, Android and web (react-native-web) from the first release: the chat screen, the
composer, image picking and Realtime must work on web too, and web is tested like the
apps. Web has no push; everything else behaves the same. If web hits a blocker that
would delay the release, web ships later and the host hides the entry points there.

### Mockups

The six screens marked "validated mockup" below were chosen from HTML mockups. Their
choices are written out in full here; the mockups themselves live with the first host
app's design notes, not in this public repo.

## Vocabulary

- **Conversation**: a DM or a group. Both hold messages and members.
- **Member of a conversation**: someone who can read and write in it. For a DM, the two
  people once the request is accepted (the sender is a member from the start).
- **Creator**: the member who created a group. App admins (`admin_users`) have every
  creator power in every group.
- **Request**: a DM whose recipient has not accepted it yet.
- **Followed conversation**: a DM, or a group whose notifications the member turned on.

## Config

New top-level `messaging` key on `CommunityConfig`, and two modules. Absent ⇒ nothing
changes anywhere (no header item, no screen, no query).

```ts
modules: {
  groups?: GroupsConfig | false;
  dms?: DmsConfig | false;
}
messaging?: MessagingConfig; // applies when groups or dms is on
```

### `MessagingConfig` (shared)

| Option            | Values                                   | SDK default  | Meaning                                                                                       |
| ----------------- | ---------------------------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `moderation`      | `"pre"` \| `"post"` \| `"reportOnly"`    | `"post"`     | Text messages: held until AI approves / shown then AI-checked / never AI-checked.             |
| `translation`     | `"off"` \| `"onDemand"`                  | `"onDemand"` | "Translate" in the message menu; cached per locale. Needs the translation module.             |
| `typingIndicator` | boolean                                  | `true`       | "X is typing…" over Realtime broadcast, never stored.                                         |
| `badge`           | `"followed"` \| `"all"` \| `"dot"`       | `"followed"` | Header badge: unread count of followed conversations + requests / of all / a dot.             |
| `hubLayout`       | `"tabs"` \| `"unified"`                  | `"tabs"`     | Messages page: two tabs (Conversations / Groups) or one list sorted by last message.          |
| `homeLayout`      | `"header"` \| `"segmented"`              | `"header"`   | Community home: groups reached from the header, or a "Feed \| Groups" selector (groups only). |
| `pushPreview`     | `"full"` \| `"sender"` \| `"none"`       | `"full"`     | Push body: sender + text / sender only / neutral text.                                        |
| `onAccountDelete` | `"keep"` \| `"eraseDms"` \| `"eraseAll"` | `"keep"`     | What the account-deletion path does with the member's messages (see "Account deletion").      |
| `maxLength`       | number                                   | `2000`       | Characters per message (database cap 4000).                                                   |
| `ratePerMinute`   | number                                   | `20`         | Messages a member may send per minute, all conversations together (enforced server-side).     |

### `GroupsConfig`

| Option                  | Values                   | SDK default  | Meaning                                                                             |
| ----------------------- | ------------------------ | ------------ | ----------------------------------------------------------------------------------- |
| `preview`               | `"readOnly"` \| `"none"` | `"readOnly"` | Non-members can open a group and read it before joining.                            |
| `exploreLayout`         | `"list"` \| `"cards"`    | `"list"`     | Explore: compact rows, or cards with a banner (for visual apps).                    |
| `shareCardLayout`       | `"card"` \| `"banner"`   | `"card"`     | The "join the group" attachment in the feed (bubbles always use the compact strip). |
| `requireAccount`        | boolean \| `"feed"`      | `"feed"`     | Joining and writing: `"feed"` runs the feed's own composer gate (`beforeCompose`).  |
| `createRequiresAccount` | boolean                  | `true`       | Creating a group needs a linked app account (enforced server-side).                 |
| `maxCreatedPerMember`   | number                   | `3`          | Active groups a member may have created (admins: unlimited).                        |
| `maxJoinedPerMember`    | number                   | `50`         | Groups a member may belong to.                                                      |
| `maxMembers`            | number \| null           | `null`       | Members per group; null = no cap.                                                   |
| `nameMaxLength`         | number                   | `60`         |                                                                                     |
| `descriptionMaxLength`  | number                   | `500`        |                                                                                     |

Group notifications are off by default for every member; this is not configurable
(a group is public and can be busy).

### `DmsConfig`

| Option                | Values                                                    | SDK default   | Meaning                                                                                 |
| --------------------- | --------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `firstMessage`        | `"direct"` \| `"requests"`                                | `"direct"`    | A first DM lands straight in the conversation list, or in the Requests zone.            |
| `entryPoints`         | array of `"profile"` \| `"newMessage"` \| `"contextMenu"` | `["profile"]` | Where "Message" appears: profile, a "new message" member picker, the post/comment menu. |
| `readReceipts`        | boolean                                                   | `false`       | "Seen" under the last message read by the other member.                                 |
| `requireAccount`      | boolean                                                   | `false`       | Sending and receiving DMs needs a linked app account (enforced server-side).            |
| `requestsPerDay`      | number                                                    | `5`           | New requests a member may start per day (`firstMessage: "requests"` only).              |
| `declineCooldownDays` | number                                                    | `30`          | After a decline, the sender cannot request that member again for this long.             |

Every option the backend enforces (the numbers, `moderation`, `firstMessage`,
`pushPreview`, `onAccountDelete`, the account rules) also lives in a backend settings
table (like `poll_settings`), set by a `messaging_set_settings` RPC. The backend trusts
only its own copy; client and backend values must be kept equal, as for polls. _(Our
call.)_

### Host adapters and screen props

- `host.onAccountRequired?(reason: "dm" | "createGroup" | "joinGroup")`: the SDK calls it
  when an action needs an account the member doesn't have; the app shows its sign-in.
- `onOpenMessages(target?)` on the feed screen, like `onOpenInbox`: the host routes to the
  Messages page, a conversation, or a group preview. Push and inbox deep links carry the
  same target (`{ conversationId }` or `{ groupId, preview: true }`).
- `beforeSendMessage?`, `beforeJoinGroup?`: optional host gates, run after the SDK's own
  checks (same contract as `beforeCompose`).

## Data model

All new tables use RLS; writes that touch more than the caller's own row go through
security-definer RPCs. Migration modules (append-only, CLI templates):

- `messaging` — the shared core. Installed automatically with `groups` or `dms`.
- `groups` — group metadata, membership rules, explore.
- `dms` — requests, opt-out, declines.

`MODULE_ORDER` gets `messaging`, `groups`, `dms` after `accounts` (they read
`account_links` when the account options are on). The `community-sdk.json` manifest
records them like the other modules.

### `messaging`

- `conversations (id, kind 'dm'|'group', created_at, last_message_at)`.
- `conversation_members (conversation_id, user_id, role 'member'|'creator', state
'active'|'request'|'removed', joined_at, last_read_at, notify boolean, removed_by,
removed_at)`. One row per member and conversation. `last_read_at` drives unread counts
  and, for DMs with read receipts, "Seen".
- `messages (id, conversation_id, author_id, body, image_path, attachment_type,
attachment_id, reply_to_id, status 'pending'|'visible'|'hidden'|'deleted', deleted_by
'author'|'creator'|'admin'|null, edited_at, lang, created_at)`. `status` uses the
  feed's vocabulary so the moderation pipeline and the dashboard treat messages like
  comments.
- `message_likes (message_id, user_id)`.
- `message_versions (message_id, body, image_path, replaced_at)`: every previous version
  of an edited message. No client access; the dashboard reads it.
- `message_translations (message_id, locale, body)`: the on-demand cache. Dropped when the
  message is edited.
- `messaging_settings`: the limits above.
- A private storage bucket `message-images`; clients get short-lived signed URLs for
  messages of conversations they can read.

Reading: a member reads the visible messages of conversations they belong to (state
`active`), plus their own pending messages. A request's recipient reads the request's
messages. With `groups.preview: "readOnly"`, anyone signed in reads the visible messages
of a visible group. Messages of blocked or blocking members are filtered out with
`blocked_member_ids()`, as in the feed.

Writing: through `send_message`, `edit_message`, `delete_message`, `like_message`,
`mark_read` RPCs that check membership, bans, blocks, the rate limit, the length cap, the
account rule and the moderation mode.

### `groups`

- `groups (conversation_id pk, name, description, image_path, status
'pending'|'visible'|'hidden'|'deleted', created_by, member_count, last_activity_at,
search tsvector)`. The pending values of an edit live in `pending_name`,
  `pending_description`, `pending_image_path` until moderation approves them; the old
  values stay visible meanwhile.
- `group_translations (group_id, locale, name, description)`: written at approval by the
  translation pipeline, into every configured locale.
- `group_removals (group_id, user_id, removed_by, removed_at)`: a removed member cannot
  rejoin until readmitted by the creator or an admin.

RPCs: `create_group`, `edit_group`, `delete_group`, `join_group`, `leave_group`,
`remove_member`, `readmit_member`, `set_group_notify`, `search_groups(query, cursor)`.
Search runs on name and description in the member's locale and the original, sorted by
`last_activity_at`.

### `dms`

- `profiles.accepts_dms boolean default true` (written through `update-profile`, like the
  other profile fields).
- `dm_declines (sender_id, recipient_id, until)`.
- A DM conversation is created by the first `send_message` to a member (`start_dm`), with
  the sender `active` and the recipient `request` (or `active` when `firstMessage:
"direct"`). One DM per pair of members.

RPCs: `start_dm`, `accept_request`, `decline_request` (silent, writes `dm_declines`),
`block_and_report_request` (reuses `blocks` and `reports`).

## Behaviour

### Moderation

- **Messages** follow `messaging.moderation`:
  - `"post"`: inserted `visible`, sent to `moderate-one`, hidden if flagged.
  - `"pre"`: inserted `pending` (the author sees it with a "sending" mark), visible when
    approved.
  - `"reportOnly"`: inserted `visible`, never sent to the AI; reports reach the dashboard.
- **A message with an image** is `pending` until the image passes, whatever the mode.
- **An edit** is moderated again under the same mode; its previous version goes to
  `message_versions` and its cached translations are dropped.
- **Group name, description and image** are always pre-moderated, at creation and at
  every edit. The `pending→visible` transition is where the group becomes searchable and
  its translations are written.
- `daily-moderation` sweeps messages like comments.
- **Deletion** leaves a placeholder: "Message deleted" (author), "Deleted by the group's
  creator" (creator), or nothing visible (admin, status `hidden`). The original stays for
  the dashboard. The creator cannot delete an app admin's messages nor remove an admin.

### Realtime

- New and changed messages arrive through Supabase Realtime (`postgres_changes` on
  `messages`, filtered by `conversation_id`, RLS applied).
- Typing goes through a Realtime broadcast channel per conversation, authorised with
  Realtime Authorization policies so only members (and group previewers, read-only) join.
- Presence in a group header ("4 online") reuses the presence module when it is on.

### Translation

- Group name and description: translated into every configured locale at approval.
- Messages: never translated in advance. "Translate" in the message menu calls a
  `translate-message` function that returns the cached text or translates and caches it.

### Chat screen (validated mockup: bubbles)

- Header: the group's picture and name, and under it "● N online" in the success green
  (the presence dot's color) when N > 0, N being the other members online (the reader is
  never counted, `groups/007`). No member count: it lives in the group's details.
- My messages on the right in the accent colour, others on the left. Consecutive
  messages by one author on one day (nobody in between) form a run: the author's name
  (groups; hidden in a DM) on the run's first bubble only, the avatar on its last only
  (the others keep its space), and only the last bubble has the tail corner (bottom
  left for others, bottom right for mine). Bubbles of a run sit closer together.
- Like: a small pill on the bubble with the count. A double tap (double click on web)
  likes or unlikes, with a small heart pop (a plain fade under Reduce Motion).
- Reply: a swipe right on a bubble (iOS and Android): it follows the finger a little
  (half the travel, at most 48 pt), a reply icon fades in, a light haptic marks the
  64 pt threshold, and it springs back (no spring under Reduce Motion). Vertical moves
  stay the list's, and a touch starting within 24 pt of the screen's left edge is left
  to the system's back swipe. Web has no swipe: Reply is in the menu.
- Menu: long press (right click or the "…" on hover or focus on web): Like, Reply, Copy,
  Translate, Edit / Delete (own), Report, and Delete for the creator / admin. Screen
  readers get "Like" / "Unlike" and "Reply" as actions on each bubble, plus the menu.
- Above the composer while replying: "Replying to <name>" and under it the replied
  message's first line, on one ellipsized line, or "📷 Photo" for a photo alone.
- Reply: a quote block inside the bubble with `@handle` and the first two lines of the
  quoted message, ending in "…"; tapping it scrolls to the original. The quote always
  shows the current text, or "Message deleted".
- Edited messages carry a discreet "edited".
- Images in the bubble, opened full-screen on tap. App attachments use
  `renderAttachment`; the group attachment uses its compact strip.
- A day separator between days, relative and in the reader's locale (Intl): "Today",
  "Yesterday" (from the locale files), the weekday within the last 6 days ("mardi"), else
  the short weekday, day and month ("mer. 18 nov."), with the year when it isn't this
  one. "X is typing…" above the composer.

### Messages page (validated mockup: tabs, unified optional)

- `hubLayout: "tabs"`: "Conversations" (Requests zone on top when there are any, then
  DMs) and "Groups" (my groups, with "Explore groups" at the top). Each tab has its unread
  count.
- `hubLayout: "unified"`: one list sorted by last message, groups with a rounded-square
  avatar, Requests on top, "Explore groups" at the bottom.
- A muted group shows its unread count in grey and doesn't light the header badge.
- With only one of the two modules on, the page shows that half without tabs.

### Header

`FeedHeaderItem` gains `"messages"` (the combined page), `"dms"` and `"groups"` (the page
opened on that tab). Each shows the badge per `messaging.badge`. Filtered out when its
module is off, like `"inbox"`.

### Community home layout (validated mockup: selector below the header)

`messaging.homeLayout` decides where groups live on the community home (decided 27 Nov
2026, so that an app can give groups more weight, and A/B test it):

- `"header"` (default): the feed screen as today; groups are reached through the
  header's `"messages"` or `"groups"` item.
- `"segmented"` (groups module on): a full-width "Feed | Groups" selector sits right under
  the header, above the topic tabs. "Feed" shows the feed unchanged. "Groups" shows, in
  this order: a search field (opening Explore), "My groups" with their unread counts (muted
  ones in grey), "To discover" with a few active groups the member hasn't joined and
  "See all", and "Create a group". The "Groups" segment carries the unread count of
  followed groups. The header then uses `"dms"`, and the Messages page shows DMs and
  requests only (no Groups tab). The selected segment is kept for the session.
- The screen reports which segment is open through `onEvent` (`community_home_segment
{segment}`), so an app can compare the layouts.

### Groups

- **Explore** (validated mockup: compact list; cards optional): search bar, results
  sorted by recent activity, each row with avatar, name, one line of description,
  "N members · X online" (online shown only above 0, hidden members excluded, presence
  module needed), and "Join" or "Open". A `+` creates a group.
- **Preview**: the chat screen read-only, with a "Join" bar instead of the composer.
  Joining is instant.
- **Creation** (validated mockup: one sheet): image (optional), name, description, a line
  saying the group is public and checked before it appears. After "Create", the group
  exists for its creator only, marked "Under review"; the creator can already write in
  it. If moderation rejects a field, the creator is told which and asked to fix it; the
  group stays invisible meanwhile.
- **Details** (validated mockup: settings list): header (image, name, counts,
  description), then rows: Notifications switch, Members (count, opens the list with
  search; members only, non-members see the count), Share in the community; then Report
  and Leave. The creator and admins also get Edit and, in the member list, Remove /
  Readmit.
- **Notifications**: a bell in the chat header (bell / crossed bell) and the switch in
  details are the same setting, off by default.
- **Creator leaves**: management falls to the app admins; the group lives on.
- **Delete**: by the creator or an admin. The group disappears; every share card shows
  "This group no longer exists".

### The "join the group" attachment

A built-in attachment type `group`, rendered by the SDK unless the app's
`renderAttachment` handles it. It shows the group's image, translated name and
description, member count, "X online" (above 0), and "Join" or "Open".

- In a post: the medium card (validated mockup A), or the banner card with
  `shareCardLayout: "banner"`.
- In a message bubble: the compact one-line strip, no description.
- Shared from group details → "Share in the community", which opens the composer with the
  card attached. Any member of the group can share it, in a post, a DM or another group.
- It works even when the app's attachments module is off (it then allows this one type).

### DMs

- **Opt-out**: "Receive direct messages" in the community profile edit sheet, next to
  the presence and badge switches. On by default.
- **"Message" button**: per `dms.entryPoints`; hidden on my own profile, when the member
  refuses DMs, when either of us blocked the other, and, with `requireAccount`, on the
  profile of a member who has no account. With `requireAccount` and no account of my own,
  the button calls `host.onAccountRequired("dm")`.
- **Requests** (`firstMessage: "requests"`, validated mockup: list, then conversation):
  - The Requests list shows each sender's name, last message and time.
  - Opening one shows the conversation read-only with the sender's context under their
    name: groups in common and how long they have been a member.
  - A bar replaces the composer: Accept / Decline / Block and report. Accepting turns the
    screen into the live conversation.
  - The sender doesn't know the request was read until it is accepted (no read state, no
    receipts on requests).
  - The sender may send several messages while pending.
  - **Decline is silent** (decided 27 Nov 2026):
    - The sender's side doesn't change: the request still looks sent, and they can keep
      writing. What they write after the decline is stored but never shown to the
      recipient.
    - Once `declineCooldownDays` have passed, the sender's next message starts a new
      request, which shows only the messages written after the cooldown ended.
    - The recipient never sees the declined request's messages again.
  - A new request sends one neutral push to the recipient (no name, no content), whatever
    `pushPreview` says; later messages of the same request don't push.
- **Read receipts** (`readReceipts: true`): "Seen" under my last message the other member
  read.

### Notifications and push

- A new message pushes to every member of the conversation who follows it (DMs always;
  groups when their switch is on), except the author, members who blocked them, members
  whose app-level messaging switch is off, and members currently viewing the conversation.
- With `moderation: "post"`, the push leaves once the AI has passed the message (a few
  seconds); with `"pre"`, when it is approved; a message moderation hides never pushes.
  _(Our call.)_
- The body follows `pushPreview`. Each push carries the deep-link target.
- **App-level switches**: two per-member preferences, "Direct messages" and "Groups",
  stored server-side (`notification_preferences (user_id, dms, groups)`), exposed in core
  as `getMessagingNotificationPrefs()` / `setMessagingNotificationPrefs()`. The app puts
  them in its own settings screen.
- Several messages in a row from one conversation collapse into one push (the push's
  collapse/thread id is the conversation id; the builder decides the throttle window).
- **Notification center and app-icon badge** (decided 27 Nov 2026):
  - Messages don't create rows in the notification center: the Messages page is their
    inbox. This is the one exception to "every community push has its inbox item".
  - The center gets the group events: group approved, a group field rejected, removed
    from a group, DM request accepted.
  - The app-icon badge counts the center's unread items plus the unread messages of
    followed conversations and pending requests. Every community push (the existing
    `notify-*` ones included) sends that sum as its `badge` value, and core exposes it
    for the host's own badge code.

### Blocking

Mutual blocks apply everywhere: no DM, no request, no "Message" button; in groups, the
blocked member's messages are hidden for the blocker and vice versa, as in the feed. An
existing DM stays in the list with its composer replaced by a line saying you can't write
to this member.

### Account deletion

`messaging.onAccountDelete`, applied by the existing `account-delete` path:

- `"keep"`: messages stay, shown under the deleted profile's placeholder name.
- `"eraseDms"`: DM messages are deleted, group messages kept.
- `"eraseAll"`: every message is deleted.

Groups the member created stay; their management falls to the admins.

### Profile merge

When the accounts module merges two profiles (`merge_profiles`), the kept profile takes
over the merged one's DMs, group memberships, created groups, likes, notification
preferences and declines. Two DMs with the same member become one conversation. _(Our
call.)_

### Analytics (`host.onEvent`)

_(Our call.)_ Events, with ids only (never message text):

`messages_opened`, `conversation_opened {kind}`, `message_sent {kind, hasImage,
hasAttachment, isReply}`, `message_liked`, `message_translated`, `message_edited`,
`message_deleted`, `message_reported`, `group_explore_opened`, `group_searched`,
`group_previewed`, `group_joined {source: explore|share|preview}`, `group_left`,
`group_created`, `group_shared`, `group_notifications_toggled {on}`, `dm_started
{source}`, `dm_request_accepted`, `dm_request_declined`, `dm_request_blocked`.

## Dashboard

Separate project (private dashboard repo), built in parallel with the SDK slices or right
after them; the release to members does not wait for it. Until it ships, AI-hidden
messages can't be reviewed or restored, and reported messages reach the team only through
the existing Slack alert.
Scope agreed: the moderation queue for messages and groups (AI-hidden included), the
context around a flagged message and its edit history, hide / restore, delete a group,
ban; and group management (list, search, members, editing name / description / image,
handing over management).

The SDK provides what it needs:

- the `message_versions` table;
- an admin-only RPC that returns a flagged message with its neighbours. For a DM it
  answers only for a message that was reported or hidden by moderation, and only within a
  bounded window around it;
- admin RPCs for group edits and transfers.

This PR updates `docs/dashboard-roadmap.md` (coverage table and bricks) as `CLAUDE.md`
requires.

## Left to the builder

- Exact RPC signatures, indexes, and the shape of the Realtime subscriptions.
- The push throttle window per conversation.
- Pagination sizes and the scroll-to-quoted-message behaviour when the original is not
  loaded yet.
- Where in the UI package the new screens live and how they reuse `Sheet`, the composer
  and the theme.
- The copy, in every locale the UI package ships.
