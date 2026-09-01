import * as fs from "node:fs";
import * as path from "node:path";
import {
  readManifest,
  writeManifest,
  migrationTemplateId,
  CURRENT_SCHEMA_VERSION,
  type Manifest,
} from "../manifest";
import {
  resolveModules,
  defaultTemplatesDir,
  resolveTemplateRoots,
  readOwnPackageVersion,
  templateBaseName,
  resolveContainedDir,
} from "../install-shared";

/**
 * `community adopt` is for an app whose community backend already exists in
 * production (hand-rolled before this SDK existed) rather than one being
 * installed fresh. It writes ONLY community-sdk.json — no migration or
 * function file ever touches disk — so `installedFiles` is always `[]`.
 *
 * `installedTemplates`, however, IS populated: it's set to every migration
 * template this CLI currently ships for the adopted modules, on the
 * assumption that a live/adopted schema already has everything up to the
 * current template set (the only schemaVersion this CLI knows how to
 * reconstruct — see the `--schema-version` mismatch warning below). This is
 * what lets a subsequent `upgrade` recognize "nothing new to add" for
 * migrations instead of trying to re-apply the app's entire schema history.
 * It deliberately does NOT extend the same courtesy to functions: those are
 * diffed by `upgrade` directly against files on disk, and adopt writes none,
 * so the first `upgrade` after an `adopt` will (correctly) seed the
 * Edge Function source into the repo for review before it's deployed.
 */
export const ALREADY_INITIALIZED_MESSAGE_ADOPT =
  "community-sdk: already initialized (found community-sdk.json) — adopt is only for a repo with no manifest yet";

export interface AdoptOptions {
  schemaVersion: number;
  modules: string[];
  /** Target Supabase directory, relative to `cwd`. Defaults to "supabase". Validated but otherwise unused — adopt copies nothing. */
  dir?: string;
  /** App repo root — where community-sdk.json lives. Defaults to process.cwd(). */
  cwd?: string;
  /** Source of the migrations/ tree, used only to compute `installedTemplates`. Defaults to the shipped templates. */
  templatesDir?: string;
  /** Called for non-fatal warnings (unknown-module-adjacent dependency warnings, schema-version mismatch). */
  onWarn?: (message: string) => void;
  /** Used to print the summary + compat-table pointer. */
  log?: (message: string) => void;
}

export interface AdoptResult {
  manifest: Manifest;
}

export async function runAdopt(options: AdoptOptions): Promise<AdoptResult> {
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? ((message: string) => console.log(message));
  const onWarn = options.onWarn ?? ((message: string) => console.warn(message));

  if (readManifest(cwd)) {
    throw new Error(ALREADY_INITIALIZED_MESSAGE_ADOPT);
  }

  if (!Number.isInteger(options.schemaVersion) || options.schemaVersion < 1) {
    throw new Error(
      `community-sdk: --schema-version must be a positive integer, got ${options.schemaVersion}`,
    );
  }

  const canonicalModules = resolveModules(options.modules, onWarn);

  const dirRel = options.dir ?? "supabase";
  // Validated for consistency with init/upgrade (and to catch typos early)
  // even though adopt never writes under it.
  resolveContainedDir(cwd, dirRel);

  const templatesDir = options.templatesDir ?? defaultTemplatesDir();
  const { migrationsSrcRoot } = resolveTemplateRoots(templatesDir);

  if (options.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    onWarn(
      `community-sdk: --schema-version ${options.schemaVersion} was requested, but this CLI only knows the templates for the current schema (version ${CURRENT_SCHEMA_VERSION}) — it cannot reconstruct a historical template snapshot. installedTemplates was populated from the CURRENT template set; consult the compat table (docs/compat.md) and adjust community-sdk.json by hand if this app's live schema predates it.`,
    );
  }

  const installedTemplates: string[] = [];
  for (const moduleName of canonicalModules) {
    const moduleSrcDir = path.join(migrationsSrcRoot, moduleName);
    if (!fs.existsSync(moduleSrcDir)) continue;
    const filenames = fs.readdirSync(moduleSrcDir).filter((f) => f.endsWith(".sql"));
    for (const filename of filenames) {
      installedTemplates.push(migrationTemplateId(moduleName, templateBaseName(filename)));
    }
  }

  const manifest: Manifest = {
    schemaVersion: options.schemaVersion,
    sdkVersion: readOwnPackageVersion(),
    modules: canonicalModules,
    installedFiles: [],
    installedTemplates: installedTemplates.sort(),
  };
  writeManifest(cwd, manifest);

  log("");
  log(
    `community-sdk adopted (${canonicalModules.join(", ")}) at schema version ${options.schemaVersion}.`,
  );
  log("No files were copied — this repo's schema/functions are assumed to already be live.");
  log(
    "Compat table: docs/compat.md (module <-> schemaVersion history, if this version isn't current).",
  );
  log("Next: `community upgrade` will seed any Edge Function source not yet present in this repo.");

  return { manifest };
}
