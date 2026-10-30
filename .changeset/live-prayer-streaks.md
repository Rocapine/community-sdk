---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

Streaks module (`modules.streaks`, `streaks/001_streaks.sql`): the host's streak on each profile, mirrored from `host.getStreak` by `syncProfileFromHost`. A bronze / silver / gold pill (under 30 days, 30 to 90, beyond 90; theme `streakBronze`/`streakSilver`/`streakGold`, icon role `streak`) sits under the author's name on posts, the profile shows the streak and the best streak, and the owner's edit sheet has two toggles (`useSetStreakVisibility`). A hidden value never leaves the database: readers only see generated `visible_*` columns.

`PostSlots.onPressReaction`: a tap on the reaction calls the host instead of toggling (e.g. open a flow that reacts at its end with `useReactToPost`).

`CommunityPost` `preview`: a read-only quote of the post (a small avatar beside the author line, three lines full width below with View more; no streak, menu, footer, image or poll), for a host's own reaction sheet.

Every community sheet now opens to the same height, right under the status bar / Dynamic Island (`snapTo="full"` is 100% below the top inset; the rules and report sheets use it too), and still pans down to close. A tap on a post's streak pill opens the author's profile. The profile sheet's streak toggles sit under the bio, with room above Save, and stay visible in both themes.

Fix: the feed's topic tabs no longer scroll vertically (the slot's hairline border ate into the row's height).
