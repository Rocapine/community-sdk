---
"@rocapine/community-ui": patch
---

Fix two bugs found in live simulator QA: `CommunitySheet` now wraps its panel in a `KeyboardAvoidingView` so composer/save buttons (ThreadSheet's comment send, ProfileEditSheet's bio Save) no longer render underneath the iOS keyboard; and `ThreadSheet`'s `useCachedPost` no longer causes a "Maximum update depth exceeded" loop on every thread open (it now skips its own thread query's cache events and only re-renders when the cached post actually changes, via `useSyncExternalStore`).
