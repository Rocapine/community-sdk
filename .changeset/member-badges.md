---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**Member badges (breaking).** The streaks module becomes a generic badges module: each
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
  `hiddenBadges`; `ThreadComment.authorBadges` is new.
- `setStreakVisibility` / `useSetStreakVisibility` → `setBadgeVisibility` /
  `useSetBadgeVisibility({ key, visible })`.
- Strings: `profile.streak` → `badge.streak.label`, `profile.bestStreak` →
  `badge.bestStreak.label`, `profile.showStreak` → `badge.streak.toggle`,
  `profile.showBestStreak` → `badge.bestStreak.toggle`, `profile.streakHelper` →
  `profile.badgesHelper`; new `profile.badges` (the toggles' header). Rename your overrides.
- `renderAvatar` now receives the member's `badges`.
