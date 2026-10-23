---
"@rocapine/community-ui": patch
---

Post stats (like, reaction, comment): a stronger press scale-down (new `PressableScale` `scale="stat"`, 0.92), and the count rolls in when it changes — from below when it goes up, from above when it goes down — via Reanimated `entering` animations (iOS, Android, web; skipped on first render and under Reduce Motion). The composer no longer expands when a poll is added on its own: like a plain post, it expands on focus or once text is typed.
