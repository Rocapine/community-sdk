---
"@rocapine/community-ui": minor
---

ProfileScreen: add optional `topInset` prop so a host mounting it as a full-screen route can push its own back button below the status bar / notch (the SDK keeps no react-native-safe-area-context dependency; the host feeds `useSafeAreaInsets().top`).
