---
"@rocapine/community": patch
---

Translation: styled Unicode text (𝐛𝐨𝐥𝐝, 𝚖𝚘𝚗𝚘…) is folded to plain letters (NFKC) before it is sent, so it no longer times out or comes back half untranslated. A call cut by OpenAI's content filter (it trips at random on some locales, e.g. the Lord's Prayer in Slovak) is split into one call per locale with a second try, instead of failing every locale of the item; incomplete responses are logged with their reason.

Redeploy the functions that translate (`translate-one`, `daily-translation`, `notify-comment`, `broadcast-post`) after `upgrade`.
