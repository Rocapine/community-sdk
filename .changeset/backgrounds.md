---
"@rocapine/community-ui": minor
---

Backgrounds. `CommunityFeedScreen`'s `header` takes `background: { image?, color?, contentFit? }`,
painted behind the header row and the topic tabs, and `topInset`: pass your safe area's top
and stop padding it, and the feed owns the status bar area (the header background reaches
behind it; the bar stops hiding there). `CommunityUIProvider` takes
`background: { image, contentFit?, opacity? }`, fixed behind the feed, the notification
center and profiles; post rows turn transparent over it while sheets and the composer stay
opaque. `useCommunityBackground()` and the `CommunityBackground` type are exported.
