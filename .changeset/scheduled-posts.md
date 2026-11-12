---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**Scheduled posts for the community dashboard.** One new migration template, used by the
dashboard to publish team drafts at a chosen time. Nothing changes in the app.

- `core/015_scheduled_posts.sql`: a pg_cron job publishes due drafts every minute, as their
  author, and `schedule_post_draft` lets the dashboard set or clear a draft's time. A post
  more than 30 minutes late is not published.

Migration: no app change needed. Run `npx @rocapine/community upgrade`, then
`supabase db push`, to get the job if the community dashboard manages this community.
