---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**Admins pin and notify everyone from the composer.** An admin's composer shows two
options above the toolbar: "Pin" (`composer.pinPost`) pins the post once it is created,
and "Notify everyone" (`composer.notifyAll`, push module only) pushes it to every member
once it is published. `CreatePostVariables` takes `pin` and `notifyAll`.

`maxPinnedPerTopic` (default 1) caps the pinned posts of a topic. Pinning one more, from
the composer or a post's `…` menu, shows a warning (`pin.limitTitle` / `pin.limitBody`)
and pins nothing; core exports `countPinnedPosts()`.

`broadcast-post` now also accepts the post's own author when that author is an admin,
besides the service role. Redeploy it with `npx @rocapine/community upgrade`.
