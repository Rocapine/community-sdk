---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
---

Flat, X-style community screens (EVR's design). Relative timestamps now count seconds, months and years (`timeAgoParts` gains the `second`, `month` and `year` units; `time.seconds`, `time.months.*` and `time.years.*` in every locale), and a label under a minute old ticks every second.

**community-ui (breaking).** The feed, the in-community profile and the notification inbox drop their cards for flat, full-width rows: the avatar in a first column, `name › topic · time` on one line with the `…` menu at its end (the `@handle` stays on the profile), and "View more" at the end of a body's last visible line. Topics are scrollable tabs, and `headerLayout.title` takes an image (`{ image, position?, accessibilityLabel? }`) for an app logo.

- **Composer.** `ComposerCard` and the floating compose bar are removed (export gone). A `+` button opens the new full-screen `ComposerSheet` (exported). `beforeSubmitPost` is replaced by **`beforeCompose: () => Promise<boolean>`**, awaited on the `+` tap after the rules and before the composer opens. Migration: pass your post gate as `beforeCompose` (it no longer receives a draft).
- **Topics.** Tapping a post's topic selects its tab in the feed (and from its search and thread). `ProfileScreen` and `ThreadSheet` take `onPressTopic(topicId)`; the feed takes `topicRequest: { topicId, requestedAt }` so a host can land on a topic from elsewhere.
- **Avatars.** `CommunityUIProvider` takes `renderAvatar({ userId, name, url, size })`, used by every avatar the SDK draws; `Avatar` is exported. The default is unchanged.
- New strings in all 13 catalogs: `composer.cancel`, `composer.discardTitle`, `composer.discard`, `composer.keepEditing`, `feed.compose`, `time.seconds`, `time.months.*`, `time.years.*`.
