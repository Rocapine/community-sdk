---
"@rocapine/community-ui": patch
---

Post stats (like, reaction, comment): the count rolls in when it changes — from above when it goes up, from below when it goes down — via Reanimated `entering` animations (iOS, Android, web; skipped on first render and under Reduce Motion). The composer no longer expands when a poll is added on its own: like a plain post, it expands on focus or once text is typed.
