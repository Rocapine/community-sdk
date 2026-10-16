---
"@rocapine/community": patch
"@rocapine/community-core": patch
"@rocapine/community-ui": patch
---

`update-profile` accepts `username` (the display name, 2–24 characters) and moderates it like the handle; `updateProfile({ username })` / `useUpdateProfile` pass it through. Hosts that let the user choose a pseudonym can now route it through moderation instead of writing `profiles.username` directly. `community upgrade` updates the function.

The feed composer and the comment composer now read `host.getDisplayName()` after the `beforeSubmitPost` / `beforeSubmitComment` gate, so a pseudonym chosen inside that gate stamps the optimistic post instead of the fallback name.
