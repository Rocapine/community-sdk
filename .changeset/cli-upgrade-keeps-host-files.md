---
"@rocapine/community": patch
---

`upgrade` no longer deletes the host's own files inside an SDK function folder (e.g. `supabase/functions/_shared/<your-dir>/`). It now overwrites only the files the template ships, removes only files an earlier SDK version installed (per `community-sdk.json`) that the template dropped, and ignores host files when deciding whether a function changed. 0.10.0 wiped such folders: if you ran `upgrade` with it, check `git status` for deleted files under `supabase/functions/` and restore them.
