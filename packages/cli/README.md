# @rocapine/community (CLI)

Installs and manages the Community SDK backend — Supabase migrations and
Edge Functions — inside your app's own Supabase project.

```bash
npx @rocapine/community <command>
```

No install needed for one-off use; `npx` always runs the latest published
version. The binary is named `community`.

## `init`

```bash
npx @rocapine/community init [--modules core,push,polls,reaction,inbox,translation] [--project-url <url>] [--anon-key <key>] [--dir supabase]
```

Copies the migrations and Edge Functions for the requested modules into
`<dir>/migrations/` and `<dir>/functions/` (default `dir`: `supabase`,
relative to the current directory), and writes a `community-sdk.json`
manifest at the repo root recording what was installed.

- `--modules` — comma-separated (`core,push,polls,reaction,inbox,translation`). `core`
  is always implied even if omitted. Omit the flag entirely to install every
  module. Regardless of the order you type them, modules are installed
  `core → push → polls → reaction → inbox → translation` — this order is load-bearing:
  the inbox module's reaction trigger is guarded at install time and must
  find the reaction module's table already present, so reaction has to land
  first. Requesting `inbox` without `reaction`, or `translation` without `polls`, prints a (non-fatal) warning (reactions missing from the inbox; poll labels left untranslated).
- `--project-url` / `--anon-key` — needed only if a migration in the
  selected modules carries a placeholder (see "Placeholder guard" below).
  If omitted, the CLI tries to read the project URL from
  `<dir>/config.toml`'s `project_id`, then prompts interactively; if stdin
  isn't a TTY and a value is still missing, it fails loudly rather than
  hanging.
- `--dir` — target Supabase directory, default `supabase`.
- Refuses to run if `community-sdk.json` already exists (use `upgrade`
  instead) — see `ALREADY_INITIALIZED_MESSAGE`.
- All-or-nothing: if anything fails partway through, every file this run
  wrote is removed before the error propagates, so a retry starts clean.

Prints next steps on success: review + `supabase db push`, set
`OPENAI_API_KEY` (and optionally `SLACK_WEBHOOK_URL`,
`COMMUNITY_APP_NAME`, `COMMUNITY_FALLBACK_NAME`, and — for the push module —
`EXPO_ACCESS_TOKEN`), then `supabase functions deploy`.

## `upgrade`

```bash
npx @rocapine/community upgrade [--project-url <url>] [--anon-key <key>] [--dir supabase]
```

Copies any migration templates shipped since `community-sdk.json` was last
written (diffed by stable template identity, `<module>/<templateBaseName>`,
not by filename — a template's numeric ordering prefix is not part of its
identity), and copies in any Edge Function present in the shipped set but
missing on disk. An Edge Function that already exists on disk but whose
content differs from the shipped template is **overwritten, with a
warning** — review the diff before deploying. `--project-url`/`--anon-key`
are only needed if a newly-added migration carries a placeholder. Fails if
`community-sdk.json` doesn't exist yet (run `init` or `adopt` first).

`--add-modules <modules>` installs one or more modules not yet in
`community-sdk.json` on top of the existing backend (comma-separated, same
parsing as `init --modules`) — e.g. `upgrade --add-modules translation` to
add the translation module to an already-initialized app.

## `adopt`

```bash
npx @rocapine/community adopt --schema-version <n> --modules core,push,... [--dir supabase]
```

For a backend that's already live in production, built by hand or migrated
before this SDK existed (the mold precedent: Eve's Rhythm and other internal
apps that hand-rolled their own community backend before this SDK existed).
Writes **only** `community-sdk.json` — no migration or function file is ever
copied — on the assumption the equivalent schema is already applied. A
subsequent `upgrade` will still seed any Edge Function source not yet
present in the repo (for review before deploy), since `adopt` never writes
function files. If `--schema-version` doesn't match the CLI's current
schema version, it warns that `installedTemplates` was reconstructed from
the _current_ template set and points at `docs/compat.md` to check/adjust
`community-sdk.json` by hand for a historical schema.

## The manifest (`community-sdk.json`)

```json
{
  "schemaVersion": 1,
  "sdkVersion": "0.1.0",
  "modules": ["core", "push", "polls", "reaction", "inbox"],
  "installedFiles": ["supabase/migrations/20260101000000_community_core_tables.sql", "..."],
  "installedTemplates": ["core/tables", "core/rls", "..."]
}
```

- `schemaVersion` — the schema version this app's backend corresponds to
  (see `docs/compat.md`).
- `sdkVersion` — the CLI package version that last touched the manifest.
- `modules` — canonical, ordered module list installed/adopted.
- `installedFiles` — every file path this CLI has written (empty for an
  `adopt`ed backend, since it copies nothing).
- `installedTemplates` — stable `<module>/<templateBaseName>` identities of
  every migration template known to be applied; this, not `installedFiles`,
  is what `upgrade` diffs against (timestamped destination filenames can't
  be compared meaningfully run to run).

## Project settings (no value is ever baked into a migration)

The pg_cron jobs and pg_net webhooks that call back into the project's own
Edge Functions read the project URL and anon key from Supabase Vault, through
two private helpers defined by `core/000_settings.sql`
(`community_project_url()` / `community_anon_key()`). The migration files are
therefore identical for every project: the same `supabase/` folder deploys to
a sandbox and to production. What differs is one statement, run once per
project after `db push`:

```bash
supabase db query "select public.community_settings_set('https://<ref>.supabase.co', '<anon key>');"
```

`init`/`upgrade` print it (filled in when `--project-url` / `--anon-key` are
passed, placeholders otherwise). Until a project is seeded, every webhook
logs a warning instead of calling out — inserts are never blocked — and the
daily sweeps catch up once it is. The anon key is public by design (it ships
inside the app binary): the Edge Functions do privileged work through their
own service-role env, the JWT only passes `verify_jwt`.
