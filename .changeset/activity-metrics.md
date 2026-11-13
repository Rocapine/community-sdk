---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**The dashboard's Activity numbers.** One new migration template that fixes and extends
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
