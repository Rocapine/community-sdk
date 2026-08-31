import * as fs from "node:fs";
import * as path from "node:path";

/**
 * community-sdk.json — written at the app repo root by `community init`
 * (and updated by `community upgrade` / `community adopt`). Tracks what was
 * installed so a second `init`/`adopt` can refuse to run and `upgrade`
 * knows what it is diffing against.
 */
export type Manifest = {
  schemaVersion: number;
  sdkVersion: string;
  modules: string[];
  installedFiles: string[];
  /**
   * Identity of every migration template already installed, one entry per
   * template as `"<module>/<templateBaseName>"` (e.g. "core/tables",
   * matching install-shared.ts `templateBaseName("001_tables.sql")`).
   *
   * This — not `installedFiles` — is what `upgrade` diffs the shipped
   * template tree against, because installedFiles holds the *timestamped
   * copy* name (`<ts>_community_core_tables.sql`) and a fresh timestamp is
   * minted on every init/upgrade run, so those names can never be
   * meaningfully compared across runs. The template's numeric ordering
   * prefix (the "001" in "001_tables.sql") is intentionally dropped from
   * the identity too: it only controls copy order within a module, and
   * once a template has shipped, a real change to it must arrive as a new,
   * separately-named template (migrations are append-only) rather than an
   * edit — so base-name identity is exactly the granularity `upgrade`
   * needs.
   *
   * Optional for backward compatibility: absent on manifests written by
   * schemaVersion 1 `init` before this field existed (Task 18).
   * `readManifest` still parses those manifests fine; `upgrade` falls back
   * to reconstructing this set from `installedFiles`' timestamped filenames
   * via `parseMigrationDestFilename` in that case (see install-shared.ts) —
   * which recovers the exact same `<module>/<templateBaseName>` shape,
   * since the prefix was already stripped before those filenames were
   * written.
   */
  installedTemplates?: string[];
};

export const MANIFEST_FILENAME = "community-sdk.json";

/** The only schemaVersion this CLI currently writes. */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Stable identity for a migration template, used to populate/diff
 * `Manifest.installedTemplates`. `templateBaseName` is the template's
 * filename with its numeric prefix and `.sql` extension stripped (see
 * install-shared.ts) — callers pass that in, not the raw template filename,
 * so this function has no filesystem-naming knowledge of its own.
 */
export function migrationTemplateId(moduleName: string, templateBaseName: string): string {
  return `${moduleName}/${templateBaseName}`;
}

export function manifestPath(dir: string): string {
  return path.join(dir, MANIFEST_FILENAME);
}

export function readManifest(dir: string): Manifest | null {
  const file = manifestPath(dir);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    throw new Error(`community-sdk: ${file} is corrupt (invalid JSON)`);
  }
}

export function writeManifest(dir: string, manifest: Manifest): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath(dir), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
