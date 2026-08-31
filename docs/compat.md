# SDK version ↔ schema version compatibility

The `@rocapine/community-*` npm packages and the Supabase backend
(migrations + Edge Functions) version independently: the schema is
identified by `community_meta.schema_version` (a single integer, written by
`core/006_meta.sql`), while the npm packages carry a normal semver. This
table is the source of truth for which combinations are compatible.

| SDK version range | Schema version | Notes |
|---|---|---|
| `0.1.x` | `1` | Initial public release. Modules: core, push, polls, reaction, inbox. |

## How this is enforced

- **`REQUIRED_SCHEMA_VERSION`** (exported from `@rocapine/community-core`,
  currently `1`) is the version the installed npm package expects. In dev
  builds only (`__DEV__`), `CommunityProvider` reads
  `community_meta.schema_version` on mount and logs a console warning — never
  throws — if it doesn't match. This is a development aid, not a runtime
  gate; a mismatched production build keeps working (or fails on whichever
  specific column/table actually changed, which is a clearer signal than a
  version-check throw would be).
- **`community-sdk.json`** (written by the CLI) records the `schemaVersion`
  a given app's backend was installed or adopted at, plus `sdkVersion` (the
  CLI package version that last touched it) and `installedTemplates` (which
  migration templates are known to be applied). `npx @rocapine/community
  upgrade` uses this to compute exactly which new templates to copy in.
- **`npx @rocapine/community adopt --schema-version <n>`** is for a backend
  that predates this SDK or was built by hand. If `<n>` doesn't match the
  CLI's current schema version, `adopt` warns that it can only reconstruct
  `installedTemplates` from the *current* template set (it has no way to
  regenerate a historical snapshot) and points here — consult the table
  above, then hand-edit `community-sdk.json`'s `installedTemplates` if the
  adopted backend is actually behind.

## When a new schema version ships

A schema-breaking change (a column rename, a table split, anything an old
client's queries would choke on) bumps `community_meta.schema_version` and
gets a new row in the table above, paired with the npm version range that
first requires it. A purely additive migration (a new nullable column, a new
index) does not need a schema version bump — `REQUIRED_SCHEMA_VERSION` only
exists to warn about genuinely incompatible drift, not every migration ever
shipped.
