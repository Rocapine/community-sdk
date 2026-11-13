# Community SDK — online presence (who is here right now)

Date: 2026-11-12 · Owner: Guillaume · Reviewed with Stan (Slack, 2026-11-12)
First consumer: Unchaind. Tested first in `examples/expo-app`.

## Intent

A recovery community feels empty when you can't tell anyone else is there. Showing who is
in the app right now, and how many people are, makes it feel alive and human: members feel
less alone in their struggle and are more inclined to post and answer. Seen in Sunflower
("Quit any addiction"), minus the part we disliked there: a marker on inactive members.

The rule that runs through every decision: **show presence, never absence.** Someone who is
here gets a green dot; someone who isn't gets nothing — no grey dot, no "Inactive", no
"active 3 h ago".

## Goals

- A green dot on the avatar of every member who is online right now and lets it show.
- A live count of people online, in the community header.
- A per-member setting to hide one's own status, on by default.
- Generic and configurable in the SDK, so each app tunes it; Unchaind uses it with the
  values below.

## Non-goals

- Last-seen times of any kind ("active 3 h ago"), shown or stored for display.
- Any marker for inactive or hidden members, anywhere.
- Reciprocity (WhatsApp-style "hide yours, lose theirs").
- Per-screen presence ("in the community right now"): the app as a whole counts.
- Presence-driven notifications ("X is online"), typing indicators, an online-members list.
- A rollout flag in Unchaind, and analytics on the header pill.

## Anti-goals (a failure even if it works)

- Anything that reads as "this person is gone" — e.g. a profile badge saying "Inactive". In a
  recovery app it reads as "did he relapse?".
- A count that lies (padded, faked or rounded up). The real number is shown.
- Activity timestamps reaching other members' devices through any API, even unused.
- A dot that flickers when someone switches to another app for a few seconds.

## Behaviour (decided)

### Who is "online"

- **Online** = the app is in the foreground, on any screen (not only the community), **plus a
  grace period after it leaves the foreground**. Default 5 minutes, a per-project backend setting (`presence_set_grace_minutes`), never a client parameter.
  Unchaind uses 5 minutes.
- A member is shown online (dot) only if online **and** their status is visible.
- **Everyone online counts in the header number, including members who hid their status**
  (they are counted anonymously; nothing identifies them).
- **Only members who already have a community identity count** (my call, after the builder
  check). Presence never creates one: no heartbeat until the app has an identity, so an app
  that gates the community behind onboarding or a paywall (Unchaind does, in
  `useCommunityIdentity`) doesn't count or create anonymous users for people who can't open
  the community. The heartbeat then runs app-wide for as long as the identity exists.
- Banned members are neither counted nor shown online (my call). Official/admin accounts
  are counted and shown like anyone else.
- **Blocks hide presence both ways** (Guillaume): if either member blocked the other, neither
  sees the other's dot. Both still count, anonymously, in the total. The online-ids lookup
  filters by the viewer's blocks in both directions. Blocking itself is being audited and
  improved separately; reuse whatever "is there a block between us" helper that work lands.
- Hiding your status does not stop you from seeing others' (no reciprocity).
- Your own avatar shows your dot when your status is visible (you are, by definition, online):
  it tells you what others see.

### The setting

- In the profile edit sheet, a new section after Badges: label **"Activity status"** (fr:
  « Statut d'activité »), one switch **"Show when I'm online"** (fr: « Montrer quand je suis en
  ligne »). **No helper text under it.**
- **On by default** for every member, existing ones included.
- Applied immediately like the badge toggles (not by Save); the switch reverts if the write
  fails — same pattern as `BadgeToggle` in `ProfileEditSheet.tsx`.

### The dot (feed, thread, comments, replies, profile)

- A green dot at the **bottom-right of the avatar**, ringed in the colour of whatever is behind
  the avatar (WhatsApp/Messenger convention). The name line is untouched.
- Everywhere the SDK draws a member avatar: feed posts, the thread's post, comments, replies,
  the profile header, and the profile's post list.
- On the profile header the dot is alone (no "Active" text) and **pulses once** when the
  profile opens. It doesn't pulse elsewhere.
- Green = the theme's `success` colour (Unchaind: `#22C55E`).
- Accessibility: the avatar's label includes "online" when the dot shows.

### The header count

- A new header item that apps place in any zone of `FeedHeaderConfig`.
- A green-tinted pill: a dot and **"12 online"** (fr: « 12 en ligne »). Digits use tabular
  figures so the pill doesn't shift as the number changes (`fontVariant: ["tabular-nums"]`).
- **Collapse:** expanded on a cold start of the app, it collapses to **"● 12"** after **3 s**
  (default, configurable; can be disabled to keep the label). Returning to the community tab,
  or from background, does **not** expand it again. Tapping it expands it for 3 s again. No
  press effect.
- The dot **pulses only while the pill is expanded**; collapsed, it is still.
- The number is the real count. A configurable **minimum** hides the pill below it; default
  **0** (always shown) in the SDK and in Unchaind for now.
- Accessibility: always announced in full ("12 people online"), collapsed or not.
- Reduce Motion: no pulses, and the collapse switches without animation.

Validated mockups (Unchaind theme, light and dark):
`unchaind/.superpowers/brainstorm/35310-1794483398/content/` — `header-counter-collapse-v2.html`
(header pill, interactive), `active-dot.html` (option 1B), `profile-and-setting.html` (profile
pulse + option 2A).

## SDK surface (decided)

- A new optional module, off unless the app enables it:
  `modules.presence?: { minCount?: number /* 0 */; collapseAfterMs?: number | false /* 3000 */ }`.
  Exact names are the builder's; the three knobs and their defaults are not.
- A new header item, e.g. `"online"`, in `FeedHeaderItem` (`packages/ui/src/utils/headerZones.ts`).
  It renders nothing when the module is off. `DEFAULT_FEED_HEADER` is unchanged.
- The avatar dot is drawn **by the SDK around whatever avatar is rendered**, so apps with a
  custom `renderAvatar` (Unchaind) get it with no work. `online` is also passed to
  `renderAvatar`'s props so an app can draw its own if it wants (my call).
- One analytics event through `emitEvent`: the visibility switch toggled, with the new value
  (e.g. `community_presence_visibility_changed { visible }`). Nothing on the pill.
- Copy in every SDK locale (`packages/ui/src/locales/*`, including `fr-vous`): the count label
  with plurals, the collapsed/expanded accessibility labels, the avatar's "online" label, the
  section label and the switch label.
- Server side: a new migration module (`supabase/migrations/presence/001_…`) for the per-member
  visibility flag (default true) and whatever presence storage the mechanism needs, wired into
  the CLI installer like the other modules.
- Repo rules from `CLAUDE.md`: update the SDK coverage table and the bricks in
  `docs/dashboard-roadmap.md`, the CHANGELOG and the module docs in the same change.

## Mechanism (my recommendation, the builder's to confirm)

The grace period rules out pure Supabase Realtime Presence on its own: iOS suspends the app
and drops the socket within seconds of backgrounding, so "5 more minutes" can't be kept
alive by the client. Recommended instead:

- The client sends a heartbeat (e.g. every 60 s while foregrounded, and once when it
  backgrounds) that stamps `last_active_at` server-side.
- "Online" = `last_active_at > now() - grace`. The grace is enforced server-side.
- Clients ask the server for (a) the count and (b) which of a given set of member ids are
  online and visible, and get booleans back — never timestamps. RLS keeps `last_active_at`
  unreadable by clients.
- Freshness: the count and dots may lag by up to about a minute (polling or a Realtime
  nudge, builder's choice). Instant updates are not required.

Storage keeps one overwritten `last_active_at` per member and no history (my call): the
dashboard can later read the current count server-side, but there are no activity logs to
show or leak.

Whatever the builder picks must keep: the grace across backgrounding, hidden members
counted but never identifiable, no timestamps reaching clients, and a cost that holds for a
few thousand concurrent members.

## Unchaind integration (decided)

- Enable `modules.presence` with the defaults (5 min, minimum 0, collapse after 3 s).
- New community header (`app/(blended)/community/index.tsx`):
  `left: [logo, "online"]`, `center: []`, `right: ["inbox", "profile"]`.
  **Search is removed from the header, and so from Unchaind's community altogether**
  (Guillaume: intended; the header item was its only entry point). The logo is the rock-and-cross icon
  (`applogo-black.png` / `applogo-white.png`) at roughly its current visual size.
- Presence counts the whole app, so the heartbeat must run app-wide once the community
  identity exists (it is created in `app/(blended)/_layout.tsx` via `useCommunityIdentity`,
  past onboarding and the subscription gate), not only while the community tab is open.
- No Amplitude flag: it ships on with the release that carries the SDK bump.
- Map the new SDK event in Unchaind's `onEvent` adapter like the existing community events.
- Check both themes; the community is shared by both design systems' entry points.
- Migrations: sandbox Supabase first, prod after Guillaume's OK.
- The Unchaind PR carries a screen recording (walkthrough: header pill expand/collapse, dots
  in feed and thread, profile pulse, the switch).

## Left to the builder

- Mechanism details within the constraints above (heartbeat period, polling vs Realtime,
  RPC shapes, batching avatar lookups per screen).
- Exact config and prop names, header item name, event name.
- Dot size and ring width per avatar size; the ring colour on each surface (feed background,
  sheets).
- Whether "cold start" is detected per JS runtime or per native launch, as long as tab
  switches and foreground returns never re-expand the pill.
- Release versioning and the order of SDK release → Unchaind bump.
