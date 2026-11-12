---
"@rocapine/community": patch
---

**An admin broadcast sets each member's real unread count on the app icon.** `broadcast-post`
used to set the badge to 1 for everyone, whatever the member had left unread. It now sends each
member their own count, and every push badge (likes, comments, reactions, broadcasts) counts the
admin posts sent to everyone, as the notification center does.

Migration: redeploy `broadcast-post`, `notify-comment`, `notify-like` and `notify-reaction`
(`supabase functions deploy`). No database change.
