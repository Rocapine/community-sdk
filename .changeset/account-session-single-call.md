---
"@rocapine/community-core": patch
---

**Accounts: one `account-session` call at a time.** At sign-in, `accountSignedIn()` and the SDK's own account check (`ensureIdentity()`) could call `account-session` together: the second one was answered `429 rate_limited`, a minted session could be dropped unused, and an anonymous profile being opened at that moment was left behind instead of being converted or merged. `accountSignedIn()` now waits for a check already running (at most 15 s) and then sends the session it opened as the bearer, and `ensureIdentity()` waits for a running `accountSignedIn()`. No backend change.
