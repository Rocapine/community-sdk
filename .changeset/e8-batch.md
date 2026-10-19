---
"@rocapine/community-core": minor
"@rocapine/community-ui": patch
"@rocapine/community": patch
---

- core: `useNotificationPreferences()` (push module) reads and updates the caller's `notify_likes` / `notify_comments` / `notify_reactions` flags with optimistic updates; `fetchNotificationPreferences` / `setNotificationPreference` underneath. `useCommunityUnseenCount(lastSeenAtIso, { enabled })` — `enabled: false` keeps a host's kill-switch arm from creating the identity or polling.
- ui: icon-only buttons (inbox bell, back, overflow menus, comment send) carry `accessibilityRole` / `accessibilityLabel` (new `a11y.*` keys in every catalog). **Default icons move to expo-symbols** (SF Symbols on iOS, Material Symbols on Android/web). BREAKING for hosts that relied on the previous defaults: `npx expo install expo-symbols` (optional peer, native module ⇒ new build) or pass a complete `icons` set. The previous icon dependency is no longer referenced anywhere.
- functions: `notify-*` send the recipient's real unread inbox count as the push `badge` (`unreadBadge`; 1 when the inbox module is absent) so the app icon badge means something. `COMMUNITY_TRANSLATION_STYLE` may be a JSON object of per-locale hints (`{ "fr": "address the reader as vous" }`), applied per target locale.
- migrations: `push/004_delete_own_push_row.sql` — a user can delete their own `push_tokens` row (account deletion); `community upgrade` copies it, then `db push`.
