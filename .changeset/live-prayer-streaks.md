---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

Streaks module (`modules.streaks`, `streaks/001_streaks.sql`): the host's streak on each profile, mirrored from `host.getStreak` by `syncProfileFromHost`. A bronze / silver / gold pill (under 30 days, 30 to 90, beyond 90; theme `streakBronze`/`streakSilver`/`streakGold`, icon role `streak`) sits under the author's name on posts, the profile shows the streak and the best streak, and the owner's edit sheet has two toggles (`useSetStreakVisibility`). A hidden value never leaves the database: readers only see generated `visible_*` columns.

`PostSlots.onPressReaction`: a tap on the reaction calls the host instead of toggling (e.g. open a flow that reacts at its end with `useReactToPost`).

Fix: the feed's topic tabs no longer scroll vertically (the slot's hairline border ate into the row's height).
