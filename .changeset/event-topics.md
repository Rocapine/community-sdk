---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
---

**Event topics.** A topic with `from` / `until` (`{ id: "nnn", from: "2026-11-01", until:
"2026-12-01" }`) only exists inside its window, read on the device's clock (a bare date
is local midnight, `until` excluded): its tab comes right after "All" and the composer
offers it, without preselecting it from "All". Outside the window the tab is gone and
its posts stay in "All" with their label. The feed re-reads the clock on focus and
foreground, and leaves a tab whose event ended for "All". Feed the dates from remote
config to move an event without a release.

**Topic styles.** `CommunityUIProvider`'s `topicStyles` gives a topic's tab an icon
before its name and a pill tinted in its color. By default an event topic is tinted in
`accent` and an admin-only topic leads with the `announcement` icon.

Core: `cfg.feedTopics(now?)`, `cfg.composeTopics(admin?, now?)` (live topics, events
first), `topicLive()`, `isEventTopic()`.
