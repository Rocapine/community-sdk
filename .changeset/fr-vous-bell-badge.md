---
"@rocapine/community-ui": minor
---

Two additions for hosts. A formal-register French catalog, `fr-vous` (exported as `frVous`): an app that addresses its users with "vous" passes `translations.locale = "fr-vous"`; any key it lacks falls back to `fr`, then `en`. And the feed's inbox bell now shows an unread dot (`useUnreadNotificationCount`), rendered only when the inbox module is on and `onOpenInbox` is wired.
