---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**Admins pin and notify everyone from the composer.** An admin's composer shows two
options above the toolbar: "Pin" (`composer.pinPost`) pins the post once it is created,
and "Notify everyone" (`composer.notifyAll`, push module only) pushes it to every member
once it is published, also when moderation publishes it later. `CreatePostVariables`
takes `pin` and `notifyAll`; core exports `requestPostBroadcast()`.

`adminPostsNotifyAll` (default false): every admin post notifies everyone, and the
composer drops the "Notify everyone" option.

`maxPinnedPerTopic` (default 1) caps the pinned posts of a topic. Pinning one more, from
the composer or a post's `…` menu, shows a warning (`pin.limitTitle` / `pin.limitBody`)
and pins nothing; core exports `countPinnedPosts()`.

**The notification center lists what was pushed.** An admin post appears in the center
only once it was sent to everyone, dated when it was sent; admin posts that were never
pushed leave it, also for app versions already installed. The broadcast never reaches
the author's own devices, and a post goes out once.

Backend: `core/013_post_broadcasts.sql` (`posts.broadcast_requested`,
`posts.broadcast_at`, `request_post_broadcast()`, admins only),
`push/005_broadcast_trigger.sql` (sends once the post is visible) and
`inbox/003_pushed_admin_posts.sql`. `broadcast-post` accepts the service role, or the
trigger for a post its admin author asked to send. Run
`npx @rocapine/community upgrade`, `supabase db push`, then redeploy `broadcast-post`.
