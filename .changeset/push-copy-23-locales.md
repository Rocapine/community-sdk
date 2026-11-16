---
"@rocapine/community": minor
---

Community pushes (comment, reply, like, reaction) have built-in copy in all 23 locales `@rocapine/community-ui` ships, instead of 9: adds `fr-vous`, `ko`, `ro`, `uk`, `nl`, `ru`, `el`, `hu`, `sv`, `nb`, `da`, `hr`, `sk` and `cs`. Russian, Croatian, Czech and Slovak counts now pick their own plural forms (before, any locale without built-in copy used the English rule, even when `COMMUNITY_PUSH_COPY` overrode its strings), and a `no` profile locale gets the Norwegian copy. Reinstall the functions with the CLI and redeploy `notify-comment`, `notify-like` and `notify-reaction` to pick it up.
