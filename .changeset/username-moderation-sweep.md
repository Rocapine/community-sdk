---
"@rocapine/community": minor
---

- New core template `core/007_username_moderation.sql`: `profiles.username` (client-writable, never moderated) is now checked by the daily sweep — flagged names are blanked and remembered so a client re-sync keeps them blank. Additive (two nullable columns + a trigger); `npx @rocapine/community upgrade` installs it.
- `daily-moderation` sweeps usernames (up to 1000 per run), lists blanked names in the Slack summary, and stays quiet (no API call, no Slack post) when there is nothing to check — so a stray anon-key call is free.
