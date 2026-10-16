---
"@rocapine/community": patch
"@rocapine/community-core": patch
---

`update-profile` accepts `username` (the display name, 2–24 characters) and moderates it like the handle; `updateProfile({ username })` / `useUpdateProfile` pass it through. Hosts that let the user choose a pseudonym can now route it through moderation instead of writing `profiles.username` directly. `community upgrade` updates the function.
