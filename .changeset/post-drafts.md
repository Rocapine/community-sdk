---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**Post drafts for the community dashboard.** Two new migration templates, used by the
dashboard to keep posts as drafts shared by the whole team and to publish them as a team
account. Nothing changes in the app.

- `core/014_post_drafts.sql`: a `post_drafts` table and `publish_post_draft`, which publishes
  a draft as its author. Service role only: no RLS policy, so the app never sees a draft.
  Pinning and notifying everyone need an admin author, enforced in `publish_post_draft`.
  Image-only drafts may have empty text, as posts do in the app.
- `images/002_draft_images.sql`: the images module keeps the images of drafts, and the
  nightly sweep no longer deletes them.

Migration: no app change needed. Run `npx @rocapine/community upgrade`, then
`supabase db push`, to get the tables if the community dashboard manages this community.
