---
"@rocapine/community-core": minor
---

Fix: the posts select embedded `poll_options(...)` regardless of `modules.polls`, so on a backend installed without the polls module (no `poll_options` table) every feed / user-posts / search query failed with PostgREST `PGRST200` and the feed rendered "unreachable". The embed is now added only when `modules.polls` is on (`buildFeedSelect(extraPostColumns, polls)`), and `mapPostRow`/`buildPoll` tolerate a missing `poll_options` field. Also: `useToggleLike` now applies its optimistic update to the user-posts and search caches too (same sweep as votes/reactions), and `useDeleteContent` invalidates them.
