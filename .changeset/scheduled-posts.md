---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**Scheduled posts for the community dashboard.** One new migration template, used by the
dashboard to publish team drafts at a chosen time. Nothing changes in the app.

- `core/015_scheduled_posts.sql`: a pg_cron job publishes due drafts every minute through
  `publish_post_draft`, as the draft's team account; the moderation log names whoever
  scheduled it. `schedule_post_draft` lets the dashboard set or clear a draft's time. A draft
  more than 30 minutes late is not published and is marked `missed`.
  A transient database error (deadlock, serialization failure, lock timeout) is retried on the
  next run. Event topics can carry a date window (`topic_from`, `topic_until`): a draft
  scheduled outside it is refused with `topic_closed`.

Migration: no app change needed. Run `npx @rocapine/community upgrade`, then
`supabase db push`, to get the job if the community dashboard manages this community.
