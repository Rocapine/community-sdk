---
"@rocapine/community-core": patch
---

`community_post_published` carries the post's attachment as `attachmentType` and `attachmentId` (`null` when the post has none), so a host can count a "share to community" only once the post is really published.
