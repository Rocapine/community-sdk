---
"@rocapine/community": patch
---

`init` records only the function files it copies in `community-sdk.json`. A host file already present in an SDK function folder (e.g. `supabase/functions/_shared/<your-dir>/`) was listed too: `init`'s rollback on error would delete it, and since 0.10.1 `upgrade` would remove it as a file the SDK no longer ships. If your manifest's `installedFiles` lists any of your own files, remove those lines before running `upgrade`.
