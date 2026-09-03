---
"@rocapine/community-ui": minor
---

Add optional pre-submit gate hooks: `ComposerCard`'s `beforeSubmit` and `ThreadSheet`'s `beforeSubmitComment` (forwarded by `CommunityFeedScreen` as `beforeSubmitPost` / `beforeSubmitComment`) let a host intercept a post or comment with an async check — e.g. a paywall that resolves once the user is entitled — before the SDK's own mutation runs. Both props are optional and default-inert: resolving `false` (or a rejection) aborts the submit silently and keeps the draft, and absent props are byte-identical to prior behavior.
