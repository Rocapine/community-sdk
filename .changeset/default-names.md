---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

Default names, and an editable display name and handle.

- Every profile now starts as "<label> <digits>" / `@<handle>-<digits>` ("User 4821" / `@user-4821` by default), assigned on the first launch in the user's language. **Breaking:** `anonymousAuthorFallback` is replaced by the optional `defaultName: { label, handle }` (`label` may be a function of the host locale).
- The app's name (`host.getDisplayName()`) seeds the profile and keeps following it, until the user edits their name in the community; then the user's edit wins. The handle follows the app's name the same way until the user picks one.
- Edit profile: new display name field; the handle field is labelled "Handle" and a taken handle comes with a free suggestion the user can take in one tap. Names and handles containing the app's name (`COMMUNITY_APP_NAME`) are refused, as are a few staff handles.
- `resetProfileIdentity()` puts the default name and handle back for account deletion.
- Backend: run `npx @rocapine/community upgrade`, then push the new migration (`core/009_default_names`) and deploy `update-profile` and `daily-moderation`.
