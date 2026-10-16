---
"@rocapine/community-core": minor
"@rocapine/community-ui": patch
---

`anonymousAuthorFallback` accepts a `(locale: string) => string` as well as a string: hosts that ship several languages can localize the name shown for authors without a username. Read it through the new `cfg.authorFallback()` (resolved against `host.getLocale()`); the UI package does.
