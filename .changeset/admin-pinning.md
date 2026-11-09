---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**Admins pin posts from the app.** An admin's `…` menu on a post offers "Pin" or
"Unpin" (`post.pin` / `post.unpin`). Pinned posts lead "All" and their topic, newest pin
first, until unpinned. Through `set_post_pinned` (`core/012_pin_posts.sql`), which
refuses anyone but an admin; `usePinPost()` / `setPostPinned()` in core. Run
`npx @rocapine/community upgrade` and `supabase db push`.
