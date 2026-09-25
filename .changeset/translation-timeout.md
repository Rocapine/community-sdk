---
"@rocapine/community": patch
---

The OpenAI translation timeout scales with text length and target count (20 s + 5 ms per character per locale, capped at 90 s): long posts no longer time out on every attempt.
