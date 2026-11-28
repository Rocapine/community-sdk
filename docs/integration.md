# Integrating the Community SDK into an app

The end-to-end recipe for wiring the SDK into an Expo app, in order. It is
the always-current version of the Rocapine `/roca-features:community`
feature-building skill, which walks an agent through the same phases. For
exact signatures, see the per-package READMEs.

## Phase 0 — Before starting

- **The host app:** Expo with a dev client (not Expo Go) and TypeScript. Mount a
  React Query `QueryClientProvider` somewhere above the community screens.
- **A Supabase project** of its own for this app. This SDK is not a shared backend.
  Note its project ref, URL and anon key.
- **Secrets:**
  - an OpenAI API key. Moderation is **required** and can't be turned off. With
    the translation module, the key also needs Responses (write) access.
  - optional: a Slack incoming-webhook URL for report and moderation alerts.
  - optional: an Expo access token, needed only for the push module on an
    Enhanced-Security Expo project.
- **Product decisions:**
  - the topic list and which topics are admin-only;
  - the anonymous-author fallback name;
  - which optional modules you ship: push, polls, inbox, the reaction and what
    it means (cheer, prayer, support…), translation into which locales, and
    images (one photo per post and per comment — it adds a native module, so
    the next build must include `expo-image-manipulator`), and badges (the
    app's own member badges, e.g. a streak, shown on posts, comments and
    profiles, through `host.getBadges`), and online presence (a green dot on
    avatars of members in the app, and an online count in the feed header).

## Phase 1 — Backend

1. **Enable anonymous sign-ins.** In the Supabase dashboard, go to
   Authentication → Sign In / Up and allow anonymous sign-ins, or set
   `enable_anonymous_sign_ins = true` in `config.toml`. No migration does this
   for you. Without it, every community call resolves a null identity.
2. **Copy the modules** from the app repo root:

   ```bash
   npx @rocapine/community init --modules core,push,polls,reaction,inbox,translation,images,badges,presence
   ```

   Drop any module you don't want (`core` is always implied; omitting the flag
   installs every module but `accounts`, group chats' `messaging`, `groups` and
   `attachments` included). This copies migrations into `supabase/migrations/`
   and Edge Functions into `supabase/functions/`, and writes
   `community-sdk.json`. Nothing project-specific is written into the
   migrations: the same files deploy to a sandbox and to production.

3. Review the copied migrations, then run `supabase db push`.
4. **Seed the project settings** — once per Supabase project, right after the
   push (the cron jobs and webhooks read the project URL / anon key from
   Vault; `init` prints this line filled in when you pass `--project-url` and
   `--anon-key`):

   ```bash
   supabase db query --linked "select public.community_settings_set('https://<ref>.supabase.co', '<anon key>');"
   ```

5. Set the secrets and deploy the functions:

   ```bash
   supabase secrets set OPENAI_API_KEY=... SLACK_WEBHOOK_URL=... \
     COMMUNITY_APP_NAME="<app name>" COMMUNITY_FALLBACK_NAME="<anon name fallback>" \
     COMMUNITY_TRANSLATION_LOCALES=en,es-419 \
     EXPO_ACCESS_TOKEN=...
   supabase functions deploy
   ```

   - `COMMUNITY_TRANSLATION_LOCALES` is needed only for the translation module.
   - `EXPO_ACCESS_TOKEN` is needed only for the push module.
   - Two secrets must equal what the app sets in Phase 3:

     - `COMMUNITY_APP_NAME` is the app's name as users would type it: display names and handles containing it are refused (no "<App> Team" impersonation);
     - `COMMUNITY_TRANSLATION_LOCALES` must equal `modules.translation.locales`.

     Otherwise pushes and the UI disagree.

   - The full secrets table and the cron jobs are in
     [`backend-runbook.md`](backend-runbook.md).

6. **Accounts (optional).** When the app has its own accounts and members
   should keep one community profile across devices and reinstalls, add the
   `accounts` module and its secrets:

   ```bash
   supabase secrets set COMMUNITY_ACCOUNT_PROVIDER=appwrite \
     COMMUNITY_APPWRITE_ENDPOINT=<endpoint> COMMUNITY_APPWRITE_PROJECT=<project id> \
     COMMUNITY_ACCOUNT_SECRET=$(openssl rand -hex 32)
   supabase functions deploy account-session account-delete
   ```

   - `COMMUNITY_ACCOUNT_PROVIDER` is `appwrite` (Appwrite JWTs) or `jwks` (any
     provider with a published key set: `COMMUNITY_ACCOUNT_JWKS_URL`,
     `COMMUNITY_ACCOUNT_ISSUER`, `COMMUNITY_ACCOUNT_AUDIENCE`, and
     `COMMUNITY_ACCOUNT_SUBJECT_CLAIM`, `sub` by default).
   - `COMMUNITY_ACCOUNT_SECRET`: random, 32 bytes or more. **Never rotate it
     once accounts are linked**: it keys every account profile's synthetic
     email, so rotating changes them all.
   - Both functions keep `verify_jwt` on (the default): `account-delete`'s
     service-role path relies on the gateway's signature check.
   - Turn public email sign-ups off when the app never uses them
     (`[auth.email] enable_signup = false`); anonymous sign-ins stay on.
   - To adopt the profiles members already have, or to copy app ids onto a
     linked profile, define the optional SQL hooks
     `account_profile_candidates(provider text, subject text, claims jsonb) returns setof uuid`,
     `account_owns_profile(profile uuid, claims jsonb) returns boolean` (NULL counts
     as no) and `on_account_linked(profile uuid, provider text, subject text, claims jsonb) returns void`.
     They must be idempotent: an interrupted call runs them again. A failing
     `on_account_linked` is logged, not retried. Details and an end-to-end
     check in [`backend-runbook.md`](backend-runbook.md#7-accounts).

## Phase 2 — Packages

```bash
npm install @rocapine/community-core @rocapine/community-ui
npx expo install @supabase/supabase-js @tanstack/react-query react-native-reanimated \
  @gorhom/bottom-sheet react-native-gesture-handler react-native-safe-area-context \
  expo-image expo-haptics expo-image-picker expo-symbols
npx expo install expo-image-manipulator   # only with the images module
```

- **Install only the peers the app is missing.** `expo-symbols` is optional
  if you pass a full `icons` map. Any new native peer (reanimated,
  gesture-handler, image-picker, image-manipulator…) means a new native build.
- **Pin `@tanstack/react-query` in Metro. This is mandatory.** The SDK ships
  CommonJS and `require()`s React Query, while the app `import`s it. Metro's
  `exports` resolution then loads **two** copies (`index.cjs` and `index.js`),
  so the SDK's hooks never see the app's `QueryClientProvider`. The result is
  "No QueryClient set" on mount, even though the tree is correct. Pin the bare
  specifier to one file in `metro.config.js`:

  ```js
  const path = require("path");
  const { getDefaultConfig } = require("expo/metro-config");
  const config = getDefaultConfig(__dirname);
  const REACT_QUERY = path.join(
    __dirname,
    "node_modules/@tanstack/react-query/build/modern/index.js",
  );
  const resolve = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (ctx, name, platform) =>
    name === "@tanstack/react-query"
      ? { type: "sourceFile", filePath: REACT_QUERY }
      : (resolve ?? ctx.resolveRequest)(ctx, name, platform);
  module.exports = config;
  ```

  (`examples/expo-app` uses `resolver.unstable_enablePackageExports = false`
  instead, which is blunter: it turns `exports` off for every package.)

- **Reuse the app's Supabase client** if it has one. Keep AsyncStorage
  persistence and `persistSession: true`. Never call `supabase.auth.signOut()`
  in the app's own sign-out if the anonymous community identity should survive
  it.

## Phase 3 — `CommunityConfig`

One object holds all of the app's choices; see
[`packages/core/README.md`](../packages/core/README.md). Build it in one module,
e.g. `lib/community-config.ts`.

1. **Vocabulary.** Set `topics`, `appName` and, optionally, `defaultName`
   (`{ label, handle }`: every new user starts as "<label> 4821" / `@<handle>-4821`,
   "User" / `user` by default). **Names.** `host.getDisplayName()` returns the
   app's own user name to seed the community profile, or `null` to keep users
   on their default pseudonym; either way the user can change name and handle
   from the community profile, and their edit wins over the app's name.
   Everyone reads an `adminOnly` topic; only `is_admin` profiles post in it.
   The UI applies this (no `+` for members on its tab, not in their composer),
   the database does not.
2. **Modules.** Mirror exactly what Phase 1 installed: the `push`, `polls` and
   `inbox` booleans, `reaction: { key } | false`,
   `translation: { locales } | false` and `images` (boolean). Turn `images` on only
   once `expo-image-manipulator` is in the build (without it the image buttons
   stay hidden and a dev build warns once) **and** the backend has the module:
   `supabase db push` + `supabase functions deploy` first, then ship the client.
   A client with `images` on selects the image columns in every posts query, so
   against a backend without them the feed fails to load. If the app builds `FeedPost` or
   `ThreadComment` objects by hand (tests, fixtures), add `image: null`; a host
   that types a complete `CommunityIconSet` adds the new `image` role.
   **Polls.** `polls: true` allows 2 to 4 options of up to 60 characters. Another range is
   `polls: { minOptions?, maxOptions?, optionMaxLength? }` in the config **and** the same
   values on the backend, once per Supabase project, from the SQL editor (service role):
   `select public.poll_set_limits(2, 7, 100);` (2 ≤ min ≤ max ≤ 10, length 1 to 200). The
   database enforces its own copy, so keep both equal: a client above the backend gets an
   error on publish. An importer can write options beyond the limits with
   `alter table public.poll_options disable trigger user` (then `enable`).
   **Presence.** `presence: {}` (or `{ minCount?, collapseAfterMs?, appearance? }`, `appearance: "text"` for plain text instead of the collapsing pill)
   turns on the dots and the `"online"` feed header item (e.g.
   `header={{ left: ["profile", "online"], … }}`; it is dropped when the module is
   off). The app must run the heartbeat itself, once, with the resolved config:
   `useEffect(() => startPresenceHeartbeat(cfg, AppState), [cfg])` (the config passed to `CommunityProvider` must be stable, i.e. memoized: a config rebuilt on every render restarts the heartbeat every render), `AppState` from
   `react-native`. It beats only in the foreground and never signs in anonymously
   (no session, no beat). Online means in the foreground within the grace window:
   5 minutes by default, a per-project backend setting changed from the SQL editor
   (service role) with `select public.presence_set_grace_minutes(10);` (1 to 60).
   The server owns it so members can't vary it to probe when someone was last active. The caller always counts as online unless banned (hidden callers are counted, never listed).
3. **Host adapters.** Every field is optional and defaults to a no-op.
   - `getDisplayName` must be **synchronous**: read an already-hydrated store.
   - `getAnalyticsIds` must also be synchronous. The providers' own getters are
     async, so warm a cache at startup with `Promise.allSettled`.
   - `rulesAcceptance` persists the one-time guidelines acceptance.
   - `onContentPublished` fires after a publish, e.g. to arm a review prompt.
   - `getLocale` returns the app language. It is resolved against
     `modules.translation.locales` to choose the reader's language, and
     `syncProfileFromHost()` mirrors it to `profiles.locale`, which the push
     functions use to write in each recipient's language.
4. **Analytics.** `host.onEvent(name, props)` is the only analytics seam. Map
   each `COMMUNITY_EVENTS` name to the app's tracking plan. Don't forward an
   event the app already tracks itself; that double-counts. Never send
   post, comment or bio text as a property; lengths and counts only.
5. **Identity.** At startup, call `ensureIdentity(cfg)`, then
   `syncProfileFromHost(cfg)` whenever the display name or the language changes.
   Both take the resolved config: `const cfg = resolveConfig(config)` in a
   module-scope singleton, for code that runs outside the React tree.
   **With the accounts module**, set `host.getAccountProof` (a fresh proof of
   the app account, `null` when signed out; throw when signed in but no proof
   can be made right now) and wire the app's auth transitions:
   - `accountSignedIn(cfg)` every time the app session is (re)established,
     including at launch for a member already signed in (otherwise a stored
     anonymous session is kept; once this launch has checked the account, it
     does nothing). It rejects when no session could be opened, or when a
     second call overtook it: call it again later.
   - `accountSignedOut(cfg)` on logout, **before** the app's own logout. A
     switch from account A to B is `accountSignedOut(cfg)` then
     `accountSignedIn(cfg)`.
   - `deleteAccountProfile(cfg)` **before** disabling the app account; don't
     disable it when it returns `false`.
   - After each of these transitions, call `resetCommunityQueries(queryClient)`
     so the screens refetch as the new profile.
   - With push, set `host.getInstallId` and call
     `registerPushDevice(cfg, token)` again after each of these transitions.
   - `accounts: { required: true }` when signed-out users must not get an
     anonymous profile (the community stays hidden until sign-in).
     See [`packages/core/README.md`](../packages/core/README.md#accounts-accounts-module).
6. **Theme, i18n and icons** go on `CommunityUIProvider`: `theme`,
   `translations: { locale, overrides }` and `icons`. See
   [`packages/ui/README.md`](../packages/ui/README.md).

## Phase 4 — Provider and screens

```tsx
<QueryClientProvider client={queryClient}>
  <CommunityProvider config={config}>
    <CommunityUIProvider theme={theme} translations={translations} icons={icons}>
      {/* mount CommunityFeedScreen, ProfileScreen, NotificationInboxScreen and
          one ThreadSheet in your own router — see examples/expo-app/App.tsx */}
    </CommunityUIProvider>
  </CommunityProvider>
</QueryClientProvider>
```

- **Screens.** Navigation goes through callback props (`onOpenProfile`,
  `onOpenThread`, `onOpenPost`…). The SDK depends on no router. The sheets
  (thread, report, rules, profile edit) bring their own
  `GestureHandlerRootView` and safe-area provider, so there is nothing more to
  mount.
- **Entry-point badges.** `useCommunityUnseenCount(lastSeenAtIso, { enabled })` gives the "new
  posts" dot, and `useUnreadNotificationCount()` gives the inbox count. If the
  screen stays mounted across tab switches (native tabs), stamp the last-seen
  watermark on focus, not on mount.
- **Profile.** `ProfileEditSheet` handles the moderated username, bio and avatar.
  If you use the avatar picker or the images module, set `expo-image-picker`'s
  `photosPermission` to mention every use: the community profile photo and the
  photos members add to posts and comments. App Review reads this text.
- **Push module.** Set `host.getInstallId` (a stable id of this install) and,
  once notification permission is granted, call
  `registerPushDevice(cfg, expoPushToken)`: it writes this device's row in
  `push_devices` and makes sure the profile's `push_tokens` row exists, which
  holds the `notify_*` preferences (`useNotificationPreferences`). Call it
  again after every identity change (sign-in, sign-out, account deletion), and
  `unregisterPushDevice(cfg)` to stop pushes on this device (the account
  transitions already do). **Never write `push_tokens.expo_push_token`
  yourself:** with accounts, one profile spans several devices, and that single
  token would keep reaching a device after it signed out. The app also routes
  notification taps: the payload has `data.route: "/community"` and
  `data.kind`.

## Messaging (groups and dms modules)

Public group chats next to the feed: members create groups, find them in Explore, join,
write (text, one image, a reply, a like), and share a group's card in the feed. Everything
stays off unless `modules.groups` is set. Direct messages ride the same core: see [Direct messages](#direct-messages-dms-module).

**Backend.** `init --modules …,groups` (or `upgrade --add-modules groups`) also installs
`messaging` (the chat core) and `attachments` (a group's share card is a post attachment).
`init` without `--modules` now installs `messaging`, `groups` and `attachments` too: the
tables are there, the app shows nothing until it sets `modules.groups`. Install `push`
**before** messaging for group pushes (a later `push` means re-running `messaging/002`);
`inbox` works in either order (the group events in the center). See [`backend-runbook.md`](backend-runbook.md#8-messaging-groups-and-direct-messages)
for the order, the functions and the settings.

**Config.** Every value the backend enforces also lives in `messaging_settings`, set with
`messaging_set_settings` (runbook). Keep both equal: in dev builds `CommunityProvider`
warns when they differ.

```ts
modules: { groups: {} },             // groups' own options, below
messaging: { homeLayout: "header" }, // shared chat options, below
```

| Option                         | Default      | Meaning                                                                                                                                                                                                                                     |
| ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messaging.moderation`         | `"post"`     | `"post"`: a message shows at once and the AI hides it if it fails; `"pre"`: it waits for the AI; `"reportOnly"`: no AI, reports only. Images always wait for the AI. Backend key `moderation`.                                              |
| `messaging.translation`        | `"onDemand"` | A "Translate" action on messages (needs the `translation` module). `"off"` removes it. Group names and descriptions are translated at approval (translation module) whatever this says.                                                     |
| `messaging.typingIndicator`    | `true`       | "X is typing" in a conversation.                                                                                                                                                                                                            |
| `messaging.badge`              | `"followed"` | The header items' badge: unread messages of the groups I follow (`"followed"`), of all my groups (`"all"`), or a dot (`"dot"`) for the followed ones.                                                                                       |
| `messaging.hubLayout`          | `"tabs"`     | The Messages page: "Explore groups" on top (`"tabs"`, which becomes the Conversations / Groups tabs with DMs on) or at the bottom of a single list (`"unified"`).                                                                           |
| `messaging.homeLayout`         | `"header"`   | `"header"`: the feed reaches messages through header items. `"segmented"`: a "Feed \| Groups" switch on the feed's home (needs `onOpenMessages` and `onOpenExplore`).                                                                       |
| `messaging.pushPreview`        | `"full"`     | Group push text: the message (`"full"`), "X sent a message" (`"sender"`), or a neutral line (`"none"`). Backend only.                                                                                                                       |
| `messaging.onAccountDelete`    | `"keep"`     | What account deletion does to the member's messages: keep them, erase their DMs (`"eraseDms"`), or erase every message (`"eraseAll"`). Backend only.                                                                                        |
| `messaging.maxLength`          | `2000`       | Characters per message (database cap 4000).                                                                                                                                                                                                 |
| `messaging.ratePerMinute`      | `20`         | One per-minute budget per member: sends, edits and deletions of your own messages share it (`messaging/006`).                                                                                                                               |
| `groups.preview`               | `"readOnly"` | A non-member reads a group before joining (`"readOnly"`), or joins first (`"none"`). Backend key `groupsPreview`.                                                                                                                           |
| `groups.exploreLayout`         | `"list"`     | Explore: a compact list or `"cards"` with a banner.                                                                                                                                                                                         |
| `groups.shareCardLayout`       | `"card"`     | A group's card in the feed: `"card"` or `"banner"`.                                                                                                                                                                                         |
| `groups.requireAccount`        | `"feed"`     | Joining and writing need an app account: `true` (enforced by the backend, accounts module), `false`, or `"feed"` (client only: runs the feed's `beforeCompose` gate first). Backend key `groupsRequireAccount` (`"feed"` is `false` there). |
| `groups.createRequiresAccount` | `true`       | Creating a group needs an app account (accounts module; without it nobody could pass, so the backend skips the rule).                                                                                                                       |
| `groups.maxCreatedPerMember`   | `3`          | Groups a member may create.                                                                                                                                                                                                                 |
| `groups.maxJoinedPerMember`    | `50`         | Groups a member may belong to.                                                                                                                                                                                                              |
| `groups.maxMembers`            | `null`       | Members per group; `null` = no limit.                                                                                                                                                                                                       |
| `groups.nameMaxLength`         | `60`         | Name length (database cap 120).                                                                                                                                                                                                             |
| `groups.descriptionMaxLength`  | `500`        | Description length (database cap 1000).                                                                                                                                                                                                     |

Fixed limits, not settings: a group's creator edits it at most 5 times an hour (in-app
admins exempt; `GroupFormSheet` says to try again later), and a group under review takes
messages from its creator only, a hidden one from nobody (the chat says the group no
longer exists).

**Host adapter.** `host.onAccountRequired(reason)`, `reason` `"joinGroup"`, `"createGroup"`
or `"dm"` (a DM with a member who has no account, or my own missing one, with `dms.requireAccount`): the SDK calls it when an action needs an app account the member hasn't
linked. Show the app's sign-in there.

**Screens.** Mount them in your router like the others; navigation is callbacks.

- `CommunityFeedScreen` gains `onOpenMessages(target?)`, `onOpenExplore()` and
  `beforeJoinGroup?()`. `target` is `{ groupId, preview? }` (a group; `preview`: read-only,
  I'm not a member), `{ tab: "groups" }` (the Messages page on a tab) or nothing (the
  Messages page); `{ conversationId }` is a DM (dms module). Without `onOpenMessages` there are
  no messages header items, no Groups home, and a group card only joins.
- `NotificationInboxScreen` gains `onOpenMessages({ groupId, preview? } | { conversationId })` (same callback):
  "your group was approved" and "part of your group wasn't accepted" open the group; "you
  were removed from a group" opens its preview, which says so (nothing with
  `groups.preview: "none"`); "your message request was accepted" opens the DM.
- `MessagesScreen`: `onOpenConversation(id)`, `onOpenExplore()`, `onBack()`, `initialTab?`.
- `ConversationScreen`: `conversationId`, `mode` (`"member"` or `"preview"`, read-only with
  a Join bar), `onOpenProfile`, `onOpenGroupDetails?`, `onOpenGroup?(groupId, preview)` (a
  group card in a message), `onOpenAttachment?`, `onBack`, `beforeSend?()` and
  `beforeJoinGroup?()` (host gates, same contract as `beforeCompose`: resolve `false` to
  cancel; with `requireAccount: "feed"`, pass the feed's `beforeCompose`), and `isFocused`
  (pass `useIsFocused()`: the conversation is marked read only while it has focus).
- `ExploreGroupsScreen`: `onOpenGroup(id, preview)`, `onBack`, `beforeCreate?`,
  `beforeJoinGroup?`.
- `GroupDetailsScreen`: `groupId`, `onOpenMembers`, `onShare(group)` (open the feed's
  composer with `composeRequest={{ attachment: { type: "group", id: group.id }, requestedAt }}`),
  `onLeft` (I left or deleted it: leave this screen and the conversation under it), `onBack`.
- `GroupMembersScreen`: `groupId`, `onOpenProfile`, `onBack`.

`examples/expo-app` wires all of them (`src/routes.ts`, `src/app/messages.tsx`,
`conversation/[id].tsx`, `explore.tsx`, `group/[id]/`).

**Header and home.** Header items `"messages"` (the Messages page), `"groups"` (on its
Groups tab, groups module) and `"dms"` (on its Conversations tab, dms module) carry the
unread badge (`messaging.badge`; `useMessagingBadge()` for your own entry point). With
`homeLayout: "segmented"` the groups live in the home's Groups segment, so the header needs
no `"groups"` item: with DMs on, put `"dms"` in the header there instead of `"messages"`.
The SDK doesn't switch it for you: the header is your config.

**Pushes and badge.** Group pushes need the push module. A member follows a group with the
bell in its conversation (off by default per group). The member-wide "Groups" switch for
your settings screen is `notify_group_messages` (default on) in `useNotificationPreferences()`:
`setPreference("notify_group_messages", false)`. It is read only with `modules.groups` on
(`notificationPreferenceKeys(cfg)`); otherwise `preferences.notify_group_messages` is
absent and setting it throws. Several
messages from one group within a minute push once. A message push carries
`data: { route: "/community", kind: "community_message", conversationId }`: route it with
`onOpenMessages({ groupId: conversationId })`, and skip the banner in your foreground
handler while that conversation is on screen. Every community push's `badge` is the
center's unread count plus the unread messages of followed groups. Messages never create
notification-center rows; the center gets group approved, a group field rejected, and
removed from a group (inbox module).

**Optional peer.** `npx expo install expo-clipboard` adds "Copy" to a message's menu on
iOS and Android (new native build). Without it there is no Copy; web uses the browser
clipboard.

**Chat gestures.** A double tap on a message likes or unlikes it; a swipe right replies
(iOS and Android; touches at the screen's left edge stay the back swipe). The long press
menu keeps Like and Reply, and screen readers get both as actions. `ConversationScreen`
brings its own `GestureHandlerRootView`. The header shows "● N online", the other members
online (`groups/007` leaves the reader out of every "online" count), and only when N > 0.

**Web.** The screens run on react-native-web: a message's menu opens on right click or
the "…" shown on hover and focus (long press on touch), a double click likes, Reply is in
the menu (no swipe), and the menu's Copy copies a message (bubbles take no text selection,
so a double click doesn't select a word).

**Analytics.** New `COMMUNITY_EVENTS`: `messagesOpened`, `conversationOpened`,
`messageSent`, `messageLiked`, `messageTranslated`, `messageEdited`, `messageDeleted`,
`messageReported`, `groupExploreOpened`, `groupSearched`, `groupPreviewed`, `groupJoined`,
`groupLeft`, `groupCreated`, `groupShared`, `groupNotificationsToggled`, `homeSegment`. Ids
and counts only, never message text.

### Direct messages (dms module)

One-to-one conversations on the same core, off unless `modules.dms` is set (`false` or absent:
nothing changes). A DM is a conversation of two members, one per pair, with the same chat
screen, composer, likes, replies, edits, translation, typing, report and block as a group.

**Backend.** `init --modules …,dms` or `upgrade --add-modules dms` (it also installs
`messaging`), `supabase db push`, then `messaging_set_settings` with the DM keys below. See
[`backend-runbook.md`](backend-runbook.md#8-messaging-groups-and-direct-messages), "Direct messages", for the
migrations, the order and the traps (adding `push` or `groups` after `dms` re-runs files).

```ts
modules: { dms: { firstMessage: "requests", entryPoints: ["profile", "newMessage"] } },
```

| Option                    | Default       | Meaning                                                                                                                                                                     |
| ------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dms.firstMessage`        | `"direct"`    | A first message lands in the recipient's conversations (`"direct"`), or waits in their Requests until they accept (`"requests"`). Backend key `dmsFirstMessage`.            |
| `dms.entryPoints`         | `["profile"]` | Where "Message" appears: a member's `"profile"`, the `"newMessage"` picker (a pencil on the Messages page), the `"contextMenu"` of a post, comment or message. Client only. |
| `dms.readReceipts`        | `false`       | "Seen" under my last message once the other member read it. Never on a request. Backend key `dmsReadReceipts`.                                                              |
| `dms.requireAccount`      | `false`       | Both members need a linked app account (accounts module) to start a DM. Backend key `dmsRequireAccount`.                                                                    |
| `dms.requestsPerDay`      | `5`           | New requests a member may start per day (`firstMessage: "requests"` only), at least 1. Backend key `dmsRequestsPerDay`.                                                     |
| `dms.declineCooldownDays` | `30`          | After a decline, the sender can't start a new request to that member for this long (0 = no wait). Backend key `dmsDeclineCooldownDays`.                                     |

As for groups, keep the app's values equal to `messaging_settings`: dev builds warn when
they differ. The shared `messaging.*` options (moderation, translation, typing, `badge`,
`hubLayout`, `pushPreview`, `maxLength`, `ratePerMinute`) apply to DMs too.

**Entry points.** "Message" is hidden on my own profile, when either of us blocked the other,
and when the member turned DMs off ("Receive direct messages", a switch in the profile edit
sheet, on by default; `useAcceptsDms()` / `useSetAcceptsDms()`). It still opens a DM that
already exists with a member who turned DMs off later: the switch only blocks new DMs.
With `requireAccount` it is hidden on the profile of a member without an account, and
without an account of my own it calls `host.onAccountRequired("dm")`. The server enforces
the same rule for both sides and refuses `account_required`.

**Requests** (`firstMessage: "requests"`). The Messages page shows a Requests row while
requests wait. A request opens read-only with the sender's context (groups in common, member
since) and an Accept / Decline / Block and report bar; accepting turns it into the live
conversation and gives the sender a "request accepted" row in the center (inbox module).
Without `onOpenRequests`, `MessagesScreen` shows `RequestsScreen` inside itself; pass
`onOpenRequests` to give it your own route (`RequestsScreen` takes `onOpenRequest(conversationId)`
and `onBack`; a request opens in `ConversationScreen`). A decline is silent: the sender still sees their message as sent and may keep
writing, but the recipient never sees a declined request's messages again. After
`declineCooldownDays` the sender's next message starts a new request showing only what follows.
It is gated like a new DM (the member's switch, the per-day budget, the account rule,
blocks); when it can't start, the message is stored and nobody is told.

**Read receipts.** With `readReceipts`, "Seen" shows under my last message once the peer
read it, only when both are active and not blocked: a request never tells its sender it was
read.

**Account rule.** With `requireAccount` both members need an account. Without the accounts
module the rule doesn't apply on the server (nobody could pass).

**Pushes.** Needs the push module. A DM message pushes to the other member (the group "bell"
doesn't apply: a DM is always followed), at most once a minute per conversation unless they
read it since, never across a block. The member-wide switch for your settings screen is
`notify_dms` (default on) in `useNotificationPreferences()`: `setPreference("notify_dms",
false)`. Like `notify_group_messages`, it is read only with its module on
(`notificationPreferenceKeys(cfg)`), and setting it without `modules.dms` throws. A new
request pushes once, on its first message, with a neutral line that names no one and quotes
nothing, whatever `pushPreview` says. The payload is the group push's:
`data: { route: "/community", kind: "community_message", conversationId }`, so route it
with `onOpenMessages({ conversationId })` and skip the banner while that conversation is
on screen. `pushPreview` for DM messages: `"full"` shows the sender as the title and the
text; `"sender"` shows "X sent you a message"; `"none"` is the neutral line with no title
(the sender's name is dropped too).

**Wiring.** `onOpenMessages({ conversationId })` opens a DM: the feed's own prop, now also
passed to `ProfileScreen` and `ThreadSheet` (the "Message" button and the post and comment
menus use it; absent: no "Message" there) and received by `NotificationInboxScreen`.
`MessagesScreen` (Conversations tab: Requests row, my DMs; with groups and dms, tabs
Conversations / Groups, or one list with `hubLayout: "unified"`) and `ConversationScreen`
serve DMs unchanged. `NewMessageSheet` is internal: `MessagesScreen` opens it from its
pencil when `entryPoints` holds `"newMessage"`. It lists members who take DMs (plus any
member I already have a DM with) and searches through `search_dm_members`.

**Header.** The `"dms"` header item opens the Messages page on its Conversations tab, with
the unread badge (DMs and pending requests). With `messaging.homeLayout: "segmented"` the
groups live on the home, so put `"dms"` in the header there rather than `"groups"`
(`resolveHeaderZones` drops a `"groups"` item in a dms-only app, which has no Groups tab).
`"messages"` remains available in either layout.

**Blocking.** A blocked pair never reaches each other: no new DM, no request, no "Message"
button, and neither side can read the DM's history (the screen shows what it cached and a
"can't write to this member" line; a block made while a DM is open closes its composer at
once). In-app admins can't be blocked out of DMs, as in the feed.

**Privacy.** Only the two members read a DM. A dashboard reads a message only through
`admin_message_context`, and only one that was reported or AI-hidden. Account deletion
follows `messaging.onAccountDelete` (`"eraseDms"` deletes the member's DM messages).
Merging two profiles merges their DMs with one member into a single conversation.

**Analytics.** New `COMMUNITY_EVENTS`: `dmStarted`, `dmRequestAccepted`, `dmRequestDeclined`,
`dmRequestBlocked`. Ids only.

## Phase 5 — Moderation

The `core` migrations include `community_dashboard` (`admin_users`,
`moderation_actions`, aggregation views, a metrics RPC), so any admin tool can
connect. Rocapine's Rocactopus dashboard is internal. Without a dashboard,
moderate through SQL or Supabase Studio: set `posts.status` or
`comments.status` to `hidden`. Never `DELETE` a row.

## Phase 6 — QA checklist

On a dev client, against the real project or a scratch one:

1. **Identity.** On first open, the anonymous identity is created and a `profiles`
   row exists.
2. **Posting.** The first post opens the rules sheet; accept it, then publish.
   The post shows up once moderation passes it. Flaggable content gets the
   rejection notice and never reaches the feed.
3. **Interactions.** Test comment, like, poll vote and reaction. The UI updates
   optimistically and the counts are right.
4. **Thread sheet.**
   - It closes with a swipe down on the handle.
   - With the keyboard up, the input stays above the keyboard and the whole
     thread still scrolls.
   - Report opens from a post's or a comment's menu.
5. **Translation.** With the app in another listed language, a post by another
   user shows "Translated from…". The "see original" toggle animates the change
   in height.
6. **Images.** With the images module: a photo post, an image-only post and a
   photo comment (from the reply bar's avatar button) appear once moderation
   passes them; the full-screen viewer zooms and closes with a swipe down; an
   image sent while offline comes back with the draft; the Image button is
   absent while a poll is open.
7. **Profile.** Setting username, bio and avatar goes through moderation.
8. **Report and block.** A report sends a Slack alert if the webhook is set; a
   harassment report offers to block the author too. A block hides both members from
   each other (posts, comments, likes, profile), and neither can comment under the
   other's posts. Admins can't be blocked. Mount `BlockedMembersScreen` and pass
   `onOpenBlockedMembers` to `ProfileScreen` (it opens from the "…" menu of your own
   profile), or link it from your settings, so members can unblock.
9. **Push and inbox.** Actions from a second account arrive as pushes, and
   tapping one routes to the community screen. The inbox shows the events and
   clears the badge.
10. **Presence.** With the presence module, two accounts on two devices: each sees the
    other's green dot on posts, comments and the profile, and the header's online
    count; backgrounding one app drops its dot after the grace window. "Show when I'm
    online" off in the profile edit sheet hides the dot but the member still counts.
    Members who blocked each other see no dot.
11. **Accounts.** With the accounts module: post anonymously, sign in, and the
    post stays yours under the same profile. Sign in to the same account on a
    second device (or after a reinstall): same profile and name, and what that
    device posted anonymously moved over. Sign out: a fresh anonymous profile
    (or none with `accounts.required`). Delete the account: every device drops
    the profile, which falls back to the default name. Pushes reach both
    devices.
12. **Groups.** With the groups module, two accounts: A creates a group, sees "under
    review", then the center's "Your group was approved"; B finds it in Explore, previews,
    joins and writes; A sees the message live, likes, replies and edits; a follower gets one
    push per burst; A removes B, and B's center says so. Share the group to the feed and
    join from its card. Repeat on web.
13. **The app's own tests** still pass.

## Maintenance

- **Upgrades are per app.**
  - Bump the npm packages.
  - `npx @rocapine/community upgrade` copies the new migrations and changed
    function templates since `community-sdk.json`. Review them, `supabase db push`,
    then redeploy the functions it touched.
  - `upgrade --add-modules <m>` adds a module (`images` for post and comment
    images, `presence` or `accounts`, then `supabase db push` and redeploy the functions).
  - [`compat.md`](compat.md) says which releases carry backend changes.
- **Never renumber or edit a migration that has been applied.** New behaviour
  always ships as a new file.
- **A backend that predates the SDK** is registered with
  `npx @rocapine/community adopt --schema-version <n> --modules <…>` instead of
  `init`. See [`packages/cli/README.md`](../packages/cli/README.md).
