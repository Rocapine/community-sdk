---
"@rocapine/community-core": patch
---

Identity: never sign in anonymously when `getSession()` reports an error. A refresh that fails offline (or inside auth-js's refresh-failure cooldown) returned `{ session: null, error }` while the session was still stored, and the SDK replaced it with a new anonymous user: the install lost its community profile. It now resolves `null` and retries on the next call.
