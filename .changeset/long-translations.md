---
"@rocapine/community": patch
---

**Long posts get translated.** Translation asked for every target locale in one OpenAI call, capped at 90 s, so a long text never made it: a 2,000-character post in 19 locales timed out on every try and stayed untranslated. `translateItem` now splits the targets into parallel calls of at most 12,000 output characters each (text length × locales), then merges them. Redeploy the functions that translate (`translate-one`, `daily-translation`, `notify-comment`, `broadcast-post`) after `upgrade`.
