---
"@rocapine/community": minor
---

Backend function templates (`npx @rocapine/community upgrade` redeploys them):

- `notify-comment` and `report-to-slack` no longer trust the trigger body: they re-read the row by id (and `notify-comment` requires it to be visible). Previously anyone holding the anon key could push arbitrary text to any post author under any name.
- `moderate-one` only accepts the row's author (user JWT) or the service role, and every status write in `moderate-one` / `daily-moderation` is guarded on the status it read, so a post deleted mid-moderation is never resurrected.
- `moderate-one` / `daily-moderation` query `poll_options` separately and tolerate its absence (core-only installs no longer 400 the daily sweep).
- Locale-aware push copy for comments/likes/reactions in 9 locales (`profiles.locale`), overridable per locale and per key through the new `COMMUNITY_PUSH_COPY` JSON secret — an app keeps its own voice without forking the functions. `COMMUNITY_FALLBACK_NAME` / `COMMUNITY_REACTION_PUSH_TEXT` still work as legacy single-string overrides.
