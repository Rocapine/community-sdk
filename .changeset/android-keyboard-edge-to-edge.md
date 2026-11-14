---
"@rocapine/community-ui": patch
---

Android: the keyboard no longer covers the comment and reply field in a thread, nor the new-post composer's toolbar. Since React Native 0.88 every `Modal` is drawn edge-to-edge on Android, so the system no longer shrinks the window for the keyboard: the bottom sheet now lifts itself (`adjustPan`), and the composer moves its toolbar up by the keyboard height plus the navigation bar. iOS is unchanged.
