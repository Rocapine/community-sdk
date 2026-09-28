---
"@rocapine/community-ui": minor
---

Sheets (thread, report, rules, profile edit) are rebuilt on `@gorhom/bottom-sheet`: swipe down from the handle (or from content scrolled to the top) to close, and in a thread the comment input stays pinned right above the keyboard while the whole thread, from the post to the last comment, stays scrollable. New peer dependencies: `@gorhom/bottom-sheet >=5.1.0`, `react-native-gesture-handler >=2.16.1`, `react-native-safe-area-context >=4.10.0` (no provider needed in the host app).
