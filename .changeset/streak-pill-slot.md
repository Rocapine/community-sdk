---
"@rocapine/community-ui": patch
---

`renderStreakPill` on `CommunityUIProvider`: the host draws every streak pill (post header, profile) from `{ days, tier, size, label }`, the tier and the localized label already resolved, nothing under one day. Without it the pill stays the flame and label on a tint of the tier colour. `StreakPillRenderProps` is exported.
