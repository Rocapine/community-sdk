# Community SDK 0.15 — closing the showcase gaps

Date: 2026-11-04 · Owner: Guillaume · From: `community-sdk-showcase/docs/sdk-gaps.md`
Current versions: `community-core` 0.14.0, `community-ui` 0.14.2, CLI 0.14.0.

## Intent

The showcase (Eve, Maia, Lockyn, Harmony, GoodBoy, My Little Chef…) needed nine host-side
workarounds. This round turns each one into a first-class, **generic** SDK option, so any
Rocapine app gets it by configuration. Three rules hold everywhere:

- **Configuration over render props.** The header and the backgrounds are configured, never
  re-rendered whole. Render slots stay only for things that are the app's own content (an
  avatar, a member badge, an attachment card, a reaction button, an inbox row).
- **Unchaind is the first consumer** and is migrated in the same round. Anything that makes
  no sense in Unchaind is exercised in the example app instead.
- **0.x, breaking allowed.** Every breaking change gets a migration note in the CHANGELOG. The
  release is **0.15.0** for the whole linked group.

## Decisions taken with Guillaume (2026-11-04)

| #   | Gap                 | Decision                                                                                                                                                            |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | `pt-BR` caption bug | Fall back to the base language name.                                                                                                                                |
| 9   | Title font          | Named typography roles, each a full text style, in the theme.                                                                                                       |
| 1   | Logo + title        | Header in three configurable zones (`left`, `center`, `right`), no render prop.                                                                                     |
| 7   | Inbox rows          | `renderInboxRow` also gets `open()` and the row's computed parts.                                                                                                   |
| 6   | Reactions           | `modules.reaction.label` + the reaction state and toggle handed to the slot.                                                                                        |
| 2   | Backgrounds         | SDK-drawn background image (whole community) and header background. No new colour token.                                                                            |
| 4   | Official accounts   | `renderAvatar` knows `official`, the handle, its placement and the member's badges; official names get their own colour.                                            |
| 3   | Member badges       | One generic system: several keyed badges per member, each with its own toggle and placements. The streak becomes two badges. Unchaind's data migrates in two steps. |
| 5   | Attachments         | A typed reference `{ type, id }` on a post, drawn and opened by the app. Members may attach only if the app allows it; official accounts always can.                |

Security stance for this round (Guillaume): no defence against technical users forging
their own badge data or attaching a reference through the API. Badge data and attachments
are written by the client with the user's session, guarded only by size checks.

## 1. Typography roles (#9)

Today the theme sets font **families** (`fonts.regular/medium/bold/serifBold/serifBoldItalic`)
and weights; ~70 text styles hard-code 14 different sizes.

New theme key `typography`, one complete style per role:

```ts
type TextRole = {
  fontFamily: string | undefined;
  fontWeight: FontWeight;
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
};
typography: {
  display: TextRole; // 24 — profile name
  title: TextRole; // 20 — feed header title, notice card title
  heading: TextRole; // 22 — sheet titles (rules, report, edit profile)
  body: TextRole; // 15 — post text, composer field
  bodySmall: TextRole; // 14 — comment text, profile bio
  label: TextRole; // 15 medium — buttons, tabs, names
  meta: TextRole; // 13 — handle · time, counts, inbox excerpt
  caption: TextRole; // 12 — helpers, pills, small print
}
```

- Defaults are derived from `fonts` and `fontWeights`, so a host that only sets `fonts`
  keeps working. `title`, `heading` and `display` default to `fonts.serifBold`.
- Every component reads a role instead of a literal size. Sizes in between (13.5, 14.5,
  11.5, 12.5) snap to the nearest role: a visible change of at most 0.5 pt, accepted.
- `mergeTheme` deep-merges `typography` per role (a host can change only `title.fontFamily`).

## 2. Header in three zones (#1)

Replaces `headerLayout: { left, right, title }` and `FeedHeaderTitle`.

```ts
type FeedHeaderItem =
  | "title" // the `title` i18n string (the community's name)
  | "profile"
  | "search"
  | "inbox"
  | { logo: ImageSourcePropType; width?: number; height?: number; accessibilityLabel?: string };

type FeedHeaderConfig = {
  left?: FeedHeaderItem[];
  center?: FeedHeaderItem[];
  right?: FeedHeaderItem[];
  background?: FeedHeaderBackground; // see §3
};

DEFAULT_FEED_HEADER = { left: ["profile"], center: ["title"], right: ["search", "inbox"] };
```

- Items in a zone sit in a row with `spacing(2)` between them. `center` is truly centred
  (the side zones get equal flex), so a long left zone never pushes it off-centre.
- A left-aligned title is `left: ["title"]` with no `center`.
- `"inbox"` still renders only with the inbox module on and `onOpenInbox` given.
- The community's name stays the `title` translation key (already overridable).
- The `profile` button's avatar goes through `renderAvatar` with `placement: "header"` (§4).
- Prop renamed `headerLayout` → `header`; the old `header?: ReactNode` slot above the row is
  **removed** (the showcase only used it for the workarounds this round replaces; Unchaind
  doesn't use it).

## 3. Backgrounds (#2)

Today the feed, inbox, profile, posts, sheets and composer all paint `colors.background`.
The showcase made it transparent to show an image behind, which also made the sheets
see-through. If the SDK draws the image itself, no new colour token is needed.

- `CommunityUIProvider` gets `background?: { image: ImageSourcePropType; contentFit?: "cover" | "contain"; opacity?: number }`.
  `CommunityFeedScreen`, `NotificationInboxScreen` and `ProfileScreen` paint
  `colors.background`, then the image, absolutely filled and fixed (it does not scroll).
- Post rows and other in-screen surfaces that paint `colors.background` become transparent
  when a background image is set, so the image shows between and behind posts. Sheets,
  the composer and the thread keep painting `colors.background`, opaque.
- `header.background?: { image?: ImageSourcePropType; color?: string; contentFit? }`:
  painted behind the feed's top bar, from the top of the screen (under the status bar)
  down to the bottom of the topic tabs, moving with the top bar when it hides on scroll.
  The SDK does not own the status-bar inset today (the host pads it); the header background
  therefore takes a `topInset` it extends upward by: `header.background.extendTop?: number`.
- No new native dependency (gradients are baked into the image). Unchaind ships this
  release as an OTA, which cannot add native code.

## 4. Avatars and official accounts (#4)

Already there: `profiles.is_official` (set server-side only, RLS reserves the `news` topic),
the verified seal on posts, comments and profiles (`icons.officialSeal`, `colors.official`).

Added:

```ts
type AvatarRenderProps = {
  userId: string | null;
  name: string;
  url: string | null;
  size: number;
  official: boolean;
  handle: string | null;
  placement: "post" | "comment" | "profile" | "header" | "composer" | "reply" | "edit";
  badges: MemberBadges; // the member's visible badges (§5), {} when unknown
};
```

- New colour `colors.officialName` (defaults to `textPrimary`) for an official author's name
  on posts, comments and the profile.

## 5. Member badges (#3)

### Model

A member can carry several **badges**, keyed by an app-defined id. The app computes their
data (never typed by the user), the member chooses which ones are shown.

```ts
type MemberBadgeData = Record<string, unknown>;          // JSON, app-defined
type MemberBadges = Record<string, MemberBadgeData>;     // visible badges only
type BadgePlacement = "post" | "comment" | "profile";

modules.badges?: Record<string, { placements: BadgePlacement[] }> | false;
host.getBadges?: () => MemberBadges | null;               // replaces host.getStreak
```

- Storage (`badges/001`): `profiles.badges jsonb not null default '{}'`,
  `profiles.hidden_badges text[] not null default '{}'`, generated
  `visible_badges = badges - hidden_badges`. Readers see only `visible_badges`; a hidden
  badge never leaves the database. Check: `octet_length(badges::text) <= 2048`.
- `syncProfileFromHost` writes `host.getBadges()` into `badges` when it changed (same
  dedup as the streak today).
- Each declared badge gets its own toggle in `ProfileEditSheet` (label
  `badge.<key>.toggle`, helper `profile.badgesHelper`). `setBadgeVisibility(key, visible)`
  replaces `setStreakVisibility`.
- `FeedPost.authorBadges`, `ThreadComment.authorBadges` and `CommunityProfile.badges` carry
  the visible badges. Posts and comments embed the author's `visible_badges` only when the
  module is on (as the streak embed does today).
- Render slot `renderMemberBadge({ key, data, placement, size })` on `CommunityUIProvider`,
  replacing `renderStreakPill`. Placements: next to the author on posts and comments
  (`size: "small"`), and as a row of stats with a label (`badge.<key>.label`) under each on
  the profile (`size: "large"`).
- Without the slot, the SDK draws the built-in **streak badges** and nothing for other keys.

### Streak as two badges

```ts
export const STREAK_BADGES = {
  streak: { placements: ["post", "profile"] },
  bestStreak: { placements: ["profile"] },
};
// data: streak = { since: ISO string }, bestStreak = { days: number }
```

Day counts are computed at render time from `since`, as now. This reproduces Unchaind's
UX exactly: two badges and two toggles on the profile, one badge on posts.

### Unchaind's live data: two-step migration

Unchaind's community went live on 2026-11-03 (1.15.0). Its installed bundles write
`streak_started_at`, `best_streak_days`, `show_streak`, `show_best_streak` and their feed
select embeds `visible_streak_started_at`: dropping a column would make **the whole feed
request fail** on any client still on the old bundle.

1. **Expand** (`streaks/002_to_badges.sql`, shipped with 0.15.0, applied with the Unchaind
   OTA): copies the legacy columns into `badges`/`hidden_badges`, keeps the legacy columns,
   and adds a `before update` trigger that keeps both forms equal in both directions. Old
   and new clients then see the same streaks whichever bundle they run.
2. **Contract** (`streaks/003_drop_legacy.sql`, a later release): drops the trigger and the
   legacy columns, once Expo Insights shows no more launches of the pre-OTA 1.15.0 bundle.

The OTA targets the 1.15.0 runtime only (`runtimeVersion` policy `appVersion`; 1.15.1 is
not released and later builds embed the new code). The web app (app.unchaind.app) is
redeployed at the same time.

New installs use the `badges` module directly; the `streaks` CLI module is kept only for
the two-step migration and is deprecated.

## 6. Reactions (#6)

- `modules.reaction: { key: string; label?: string }`. With a label, the default button
  reads icon · label · count (e.g. "Yum 12"). Active colour stays `colors.reaction`.
- `PostSlotContext` gains `reaction: { active: boolean; count: number; toggle(): void }`,
  so `renderReactionButton` can draw its own button without re-implementing the toggle.
  `toggle` honours `onPressReaction` exactly like the default button.

## 7. Inbox rows (#7)

`renderInboxRow(item, defaults, meta)` — `meta` grows from `{ unread }` to:

```ts
{
  unread: boolean;
  open(): void;              // what tapping the default row does
  parts: {
    icon: ReactNode | null;  // the kind's icon, already themed
    title: string;
    excerpt: string | null;
    timeLabel: string;       // "3 h"
  };
}
```

The default row is built from the same `parts`.

## 8. Translation caption (#8)

`translationLine` looks up `language.<locale>`, then `language.<base>` (`pt-BR` → `pt`),
then falls back to the raw code.

## 9. Attachments (#5)

A post can carry **one reference to the app's own content**. The post never stores a URL,
a title or an image: each reader's app draws the card from its own data, in the reader's
language (a verse shows in the reader's own Bible translation).

```ts
type PostAttachment = { type: string; id: string };

modules.attachments?: {
  types: string[];             // the app's attachable types, e.g. ["verse"]
  membersCanAttach: boolean;   // false ⇒ only official accounts can attach
} | false;
```

- Storage (`attachments/001`): `posts.attachment jsonb`, insert-granted to `authenticated`,
  checked `jsonb_typeof = object`, `type` and `id` strings, `octet_length <= 512`. The
  content check is relaxed so a post with an attachment may have empty text.
- `createPost({ ..., attachment })`, `FeedPost.attachment: PostAttachment | null`. A post
  carries an attachment, a poll or an image, never two of them.
- `CommunityUIProvider` gets `renderAttachment(attachment, { placement: "post" | "thread" | "composer", open })`
  and `onOpenAttachment(attachment)`. The card sits under the post text. An unknown type,
  or a slot that returns null, shows nothing.
- **Entry point**: `CommunityFeedScreen` gets `composeRequest?: { attachment?: PostAttachment; text?: string; requestedAt: number }`
  (same pattern as `postRequest`): it opens the composer pre-filled. The app's share
  button navigates to its community screen with this request. The composer shows the
  card (`placement: "composer"`) with a remove button.
- Attaching is allowed when the author is official or `membersCanAttach` is true; otherwise
  the request's attachment is dropped with a `console.warn`. Enforced in the UI only.
- Moderation, translation, notifications and push read the text only.
- Prepared, not built: a composer button opening an app-provided picker
  (`renderAttachmentPicker`), next to the photo button.

### In Unchaind

Type `verse`, id `"<book>.<chapter>.<verses>"` (book number as the Bible reader uses it,
e.g. `"43.3.16-17"`). Share from the Bible reader's verse actions and from the home
verse of the day. The card shows the verse in the reader's language and a button that
opens the Bible reader at that book and chapter, scrolled to the verse.

## Example app

`examples/expo-app` moves to Expo SDK 58 with two tabs: **Community** and **Config**. The
Config tab edits every option of this round live (theme, typography, header zones and
background, community background, badges, reaction label, inbox row style, attachments),
persisted in AsyncStorage, with presets reproducing the showcase skins. Backend: Supabase
project `community-sdk-scratch` (`cozfrhmbjrvotpwjnqmu`), all modules installed; agents may
change its config, schema and content freely.

## Delivery

SDK (one PR per row, merged in order, each with a changeset; one 0.15.0 release at the end):

1. Example app on SDK 58 + scratch backend
2. `pt-BR` caption fallback (#8)
3. Typography roles (#9)
4. Header zones + avatar context + official name colour (#1, #4)
5. Backgrounds (#2)
6. Member badges + streak expand migration (#3)
7. Reactions (#6)
8. Inbox rows (#7)
9. Attachments (#5)
10. Release 0.15.0

Unchaind:

11. Migrate to 0.15.0 (header, badges, reaction slot) + expand migration on sandbox, then
    prod by Guillaume with the 1.15.0 OTA
12. Verse sharing (attachments)
13. Later: contract migration (`streaks/003`) once the old bundle is gone

Every PR that changes something visible carries an Argent recording (example app for SDK
PRs, Unchaind for app PRs).

## Out of scope

- Server-side enforcement of badge data or attachments (see the security stance).
- The composer's app-provided picker (only prepared).
- Attaching from the moderation dashboard.
- Server-written badges (a real leaderboard): possible with the service role already, the
  lock against client writes comes when an app needs it.
