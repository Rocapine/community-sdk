---
"@rocapine/community": minor
---

New `translation` module: `translation/001_translations.sql`, `translate-one`, `daily-translation`; `notify-comment` and `broadcast-post` send excerpts in the recipient's language; secrets `COMMUNITY_TRANSLATION_LOCALES` (required), `COMMUNITY_TRANSLATION_MODEL`, `COMMUNITY_TRANSLATION_STYLE`.

- `upgrade --add-modules <modules>` installs a module (e.g. `translation`) on an already-initialized backend, without re-running `init`.
- Deno test files (`*_test.ts`) are no longer shipped in the templates nor copied into a host's `supabase/functions/`; `upgrade` ignores a host's existing copy when diffing (and drops it when it re-syncs that function).
- A plain `upgrade` (no `--add-modules`) keeps the manifest's `modules` list as it is.
- Optional secret `COMMUNITY_TRANSLATION_SWEEP_BATCH` (items per kind per `daily-translation` run, default 250).
