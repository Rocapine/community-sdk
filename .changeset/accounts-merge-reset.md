---
"@rocapine/community-core": patch
"@rocapine/community-ui": patch
"@rocapine/community": patch
---

**Accounts: a merged profile is signed out, a deleted account's badges and streak go.** `accounts/002_merge_and_delete.sql` (no change to 001):

- `merge_profiles` revokes the merged profile's sessions (`auth.sessions`, refresh tokens cascade) and deletes its `push_devices` rows instead of moving them to the account profile, so nobody holding its old refresh token can keep acting as the emptied profile, and another device no longer receives the account's pushes. The device that signs in stays signed in: `account-session` mints its new session after the merge. As documented, call `registerPushDevice()` again after `accountSignedIn()`.
- `account_delete_profile` (used by `account-delete`) also clears the profile's badges and streak (`badges`, `hidden_badges`, and the legacy streak columns where installed), so a deleted account's old posts stop showing them.

Run `npx @rocapine/community upgrade` and `supabase db push`. No function to redeploy.
