---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**Online presence.** A green dot on a member's avatar while they are in the app, and an
"online" header item with the live count.

- Backend: the `presence` module (`npx @rocapine/community init|upgrade --add-modules
presence`). Online means in the foreground within the grace window; RPCs never return a
  timestamp. Hidden members still count, and blocked members never see each other's dot.
- Core: `modules.presence: { graceMinutes?, minCount?, collapseAfterMs? } | false`,
  `startPresenceHeartbeat(cfg, AppState)` (the host runs it; it never signs in anonymously),
  `touchPresence`, `presenceSettings`, hooks `useOnlineCount`, `useIsOnline`,
  `usePresenceVisible`, `useSetPresenceVisible`, event `community_presence_visibility_changed`.
- UI: the `"online"` feed header item (dropped when the module is off), the dot on post,
  comment and profile avatars (drawn around a custom `renderAvatar` too, which also receives `AvatarRenderProps.online`), and an
  "Activity status" switch in the profile edit sheet.
