---
"@rocapine/community-core": patch
"@rocapine/community-ui": patch
"@rocapine/community": patch
---

**One community profile per app account (new `accounts` module).** An app with its own accounts sets `host.getAccountProof` (an Appwrite JWT, or any JWT checked against a JWKS) and calls `accountSignedIn()` / `accountSignedOut()` / `deleteAccountProfile()` from its auth flows: the member keeps the same profile on every device and after a reinstall, a second device's anonymous posts, comments and likes are merged into it, and deleting the app account resets the profile and signs out every device. `accounts: { required: true }` hides the community from signed-out users instead of giving them an anonymous profile. Backend: `npx @rocapine/community upgrade --add-modules accounts`, `supabase db push`, the `COMMUNITY_ACCOUNT_*` secrets, then deploy `account-session` and `account-delete` (keep `verify_jwt` on). Optional SQL hooks adopt the profiles members already have (`account_profile_candidates`, `account_owns_profile`, `on_account_linked`). See `docs/backend-runbook.md`, section Accounts.

**Push on several devices.** `push/006_push_devices.sql` adds one push row per device (`push_devices`, keyed by the new `host.getInstallId()`); `registerPushDevice(cfg, token)` writes it and the push functions send to every device of the member plus the legacy `push_tokens` token. Run `upgrade`, `supabase db push`, then redeploy `notify-like`, `notify-comment`, `notify-reaction` and `broadcast-post`.
