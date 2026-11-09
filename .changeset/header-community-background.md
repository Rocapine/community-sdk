---
"@rocapine/community-ui": minor
---

**The feed's top bar can share the community background.** `header.background:
"community"` draws `CommunityUIProvider`'s `background` in the bar, laid out for the
whole screen and held still while the bar hides on scroll, so bar and feed read as one
image. New colors `headerText` (title, header icons, selected tab) and `headerTextMuted`
(other tabs), defaulting to `textPrimary` / `textMuted`, for a bar that needs other text
than the feed.
