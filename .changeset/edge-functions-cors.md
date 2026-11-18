---
"@rocapine/community": patch
---

`moderate-one` and `update-profile` answer the browser's CORS preflight and send CORS headers, so a web build can call them. Before, every post published from the web stayed `pending` until the daily moderation sweep, and profile edits failed. Redeploy both functions after upgrading.
