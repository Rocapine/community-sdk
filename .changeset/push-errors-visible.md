---
"@rocapine/community": patch
---

Edge Functions: a rejected Expo push (HTTP error such as `UNAUTHORIZED` when the Expo project has push security enabled and `EXPO_ACCESS_TOKEN` is unset, or an error ticket such as `DeviceNotRegistered`) is now logged with `console.error` instead of being swallowed. The templates also ship the `ro` / `uk` plural rule for the push copy that landed with the UI catalogs (#25) — `community upgrade` then updates `_shared/copy.ts` and `_shared/push.ts`.
