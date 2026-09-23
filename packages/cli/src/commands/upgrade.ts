import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { substitutePlaceholders } from "../substitute";
import {
  readManifest,
  writeManifest,
  migrationTemplateId,
  CURRENT_SCHEMA_VERSION,
  type Manifest,
} from "../manifest";
import {
  MODULE_ORDER,
  type Module,
  resolveModules,
  functionsForModules,
  defaultTemplatesDir,
  resolveTemplateRoots,
  readOwnPackageVersion,
  resolveProjectCredentials,
  formatTimestamp,
  addSeconds,
  templateBaseName,
  migrationDestFilename,
  parseMigrationDestFilename,
  listFilesRecursive,
  toRelativePosix,
  resolveContainedDir,
} from "../install-shared";

export const NOT_INITIALIZED_MESSAGE = "community-sdk: not initialized, run init (or adopt)";

export interface UpgradeOptions {
  /** Target Supabase directory, relative to `cwd`. Defaults to "supabase". */
  dir?: string;
  projectUrl?: string;
  anonKey?: string;
  /** App repo root — where community-sdk.json lives. Defaults to process.cwd(). */
  cwd?: string;
  /** Source of the migrations/ + functions/ trees. Defaults to the shipped templates. */
  templatesDir?: string;
  /** Module names to install on top of what's already in the manifest — validated, ordered and merged via resolveModules, same rules as `init --modules` (unknown names throw, dependency gaps warn). */
  addModules?: string[];
  /** Used to ask for projectUrl/anonKey when a newly copied migration needs them. */
  prompt?: (question: string) => Promise<string>;
  /** Called for non-fatal warnings — most importantly, functions overwritten with new content. */
  onWarn?: (message: string) => void;
  /** Used to print the summary + next steps. */
  log?: (message: string) => void;
  /** Clock override for deterministic migration timestamps in tests. */
  now?: Date;
}

export interface UpgradeResult {
  manifest: Manifest;
  dir: string;
  /** True when nothing needed to change — no new migrations, no function drift. */
  upToDate: boolean;
  /** Modules newly added by `addModules` (not already in the manifest). Empty when `addModules` was omitted or every named module was already installed. */
  addedModules: string[];
  /** Relative (to `cwd`) paths of newly copied migration files, in copy order. */
  addedMigrations: string[];
  /** Function names copied because they weren't present on disk yet. */
  newFunctions: string[];
  /** Function names whose installed content differed from the template and was overwritten. */
  overwrittenFunctions: string[];
}

export async function runUpgrade(options: UpgradeOptions = {}): Promise<UpgradeResult> {
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? ((message: string) => console.log(message));
  const onWarn = options.onWarn ?? ((message: string) => console.warn(message));

  const manifest = readManifest(cwd);
  if (!manifest) {
    throw new Error(NOT_INITIALIZED_MESSAGE);
  }

  const dirRel = options.dir ?? "supabase";
  const dir = resolveContainedDir(cwd, dirRel);

  const templatesDir = options.templatesDir ?? defaultTemplatesDir();
  const { migrationsSrcRoot, functionsSrcRoot } = resolveTemplateRoots(templatesDir);

  // By default only modules the app already has installed are diffed/re-synced.
  // `addModules` extends that list through the same validation/ordering/warning
  // rules `init --modules` uses; left empty/undefined, behaviour here must stay
  // byte-identical to the pre-`addModules` path (no resolveModules call, no
  // spurious warnings for e.g. an existing inbox-without-reaction install).
  const canonicalModules =
    options.addModules && options.addModules.length > 0
      ? resolveModules([...manifest.modules, ...options.addModules], onWarn)
      : MODULE_ORDER.filter((m) => manifest.modules.includes(m));
  const addedModules = canonicalModules.filter((m) => !manifest.modules.includes(m));

  const installedTemplateIds = new Set<string>(
    manifest.installedTemplates ?? reconstructInstalledTemplateIds(manifest.installedFiles),
  );

  // ---- pending (not-yet-installed) migration templates, in ruled module
  // order, sorted within each module — identical ordering rule to init. ----
  type PendingMigration = { moduleName: Module; templateFilename: string; rawSql: string };
  const pending: PendingMigration[] = [];
  for (const moduleName of canonicalModules) {
    const moduleSrcDir = path.join(migrationsSrcRoot, moduleName);
    if (!fs.existsSync(moduleSrcDir)) continue;
    const filenames = fs
      .readdirSync(moduleSrcDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const filename of filenames) {
      const id = migrationTemplateId(moduleName, templateBaseName(filename));
      if (installedTemplateIds.has(id)) continue;
      pending.push({
        moduleName,
        templateFilename: filename,
        rawSql: fs.readFileSync(path.join(moduleSrcDir, filename), "utf8"),
      });
    }
  }

  // ---- functions: new (not on disk yet) vs changed (content differs) ----
  const functionsDestRoot = path.join(dir, "functions");
  const newFunctions: string[] = [];
  const changedFunctions: string[] = [];
  for (const fnName of functionsForModules(canonicalModules)) {
    const srcDir = path.join(functionsSrcRoot, fnName);
    if (!fs.existsSync(srcDir)) continue;
    const destDir = path.join(functionsDestRoot, fnName);
    if (!fs.existsSync(destDir)) {
      newFunctions.push(fnName);
    } else if (functionDirDiffers(srcDir, destDir)) {
      changedFunctions.push(fnName);
    }
  }

  if (pending.length === 0 && newFunctions.length === 0 && changedFunctions.length === 0) {
    log("community-sdk: already up to date");
    return {
      manifest,
      dir,
      upToDate: true,
      addedModules,
      addedMigrations: [],
      newFunctions: [],
      overwrittenFunctions: [],
    };
  }

  // ---- credentials, only if a pending migration actually needs them ----
  const needsCredentials = pending.some((p) => p.rawSql.includes("__SUPABASE"));
  let projectUrl: string | undefined;
  let anonKey: string | undefined;
  if (needsCredentials) {
    const creds = await resolveProjectCredentials({
      dir,
      projectUrl: options.projectUrl,
      anonKey: options.anonKey,
      prompt: options.prompt,
    });
    projectUrl = creds.projectUrl;
    anonKey = creds.anonKey;
  }

  const migrationsDestRoot = path.join(dir, "migrations");
  const writtenMigrationPaths: string[] = [];
  const addedMigrations: string[] = [];
  const newInstalledTemplateIds = new Set(installedTemplateIds);
  const createdFunctionDirs: string[] = [];
  const backups: { destDir: string; backupDir: string }[] = [];

  try {
    // ---- prepare every migration's final content up front: a placeholder
    // error here must throw before a single byte is written to disk. ----
    const now = options.now ?? new Date();
    const prepared = pending.map((p) => {
      if (!p.rawSql.includes("__SUPABASE")) return { ...p, content: p.rawSql };
      try {
        return {
          ...p,
          content: substitutePlaceholders(p.rawSql, { projectUrl: projectUrl!, anonKey: anonKey! }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${message} (source: ${p.moduleName}/${p.templateFilename})`);
      }
    });

    if (prepared.length > 0) {
      fs.mkdirSync(migrationsDestRoot, { recursive: true });
      prepared.forEach((p, index) => {
        const timestamp = formatTimestamp(addSeconds(now, index));
        const name = templateBaseName(p.templateFilename);
        const destFilename = migrationDestFilename(timestamp, p.moduleName, name);
        const destPath = path.join(migrationsDestRoot, destFilename);
        fs.writeFileSync(destPath, p.content, "utf8");
        writtenMigrationPaths.push(destPath);
        addedMigrations.push(toRelativePosix(cwd, destPath));
        newInstalledTemplateIds.add(migrationTemplateId(p.moduleName, name));
      });
    }

    if (newFunctions.length > 0) {
      fs.mkdirSync(functionsDestRoot, { recursive: true });
    }
    for (const fnName of newFunctions) {
      const destDir = path.join(functionsDestRoot, fnName);
      fs.cpSync(path.join(functionsSrcRoot, fnName), destDir, { recursive: true });
      createdFunctionDirs.push(destDir);
    }

    for (const fnName of changedFunctions) {
      const destDir = path.join(functionsDestRoot, fnName);
      const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "community-sdk-upgrade-backup-"));
      fs.cpSync(destDir, backupDir, { recursive: true });
      backups.push({ destDir, backupDir });
      fs.rmSync(destDir, { recursive: true, force: true });
      fs.cpSync(path.join(functionsSrcRoot, fnName), destDir, { recursive: true });
    }
  } catch (err) {
    for (const p of writtenMigrationPaths) fs.rmSync(p, { force: true });
    for (const d of createdFunctionDirs) fs.rmSync(d, { recursive: true, force: true });
    for (const b of backups) {
      fs.rmSync(b.destDir, { recursive: true, force: true });
      fs.cpSync(b.backupDir, b.destDir, { recursive: true });
    }
    throw err;
  } finally {
    for (const b of backups) fs.rmSync(b.backupDir, { recursive: true, force: true });
  }

  // ---- manifest: fold in the newly added migrations + refreshed function
  // file listings, dropping any stale entries for files a touched function
  // no longer ships (e.g. one removed from a newer template). ----
  const touchedFunctionDirs = [
    ...createdFunctionDirs,
    ...changedFunctions.map((fnName) => path.join(functionsDestRoot, fnName)),
  ];
  const touchedFunctionDirPrefixes = touchedFunctionDirs.map((d) => `${toRelativePosix(cwd, d)}/`);
  const touchedFunctionFiles = touchedFunctionDirs.flatMap((d) =>
    listFilesRecursive(d).map((f) => toRelativePosix(cwd, f)),
  );
  const survivingOldFiles = manifest.installedFiles.filter(
    (f) => !touchedFunctionDirPrefixes.some((prefix) => f.startsWith(prefix)),
  );
  const installedFiles = [
    ...new Set([...survivingOldFiles, ...touchedFunctionFiles, ...addedMigrations]),
  ].sort();

  const updatedManifest: Manifest = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sdkVersion: readOwnPackageVersion(),
    modules: canonicalModules,
    installedFiles,
    installedTemplates: [...newInstalledTemplateIds].sort(),
  };
  writeManifest(cwd, updatedManifest);

  printSummary(log, onWarn, {
    addedModules,
    addedMigrations,
    newFunctions,
    overwrittenFunctions: changedFunctions,
  });

  return {
    manifest: updatedManifest,
    dir,
    upToDate: false,
    addedModules,
    addedMigrations,
    newFunctions,
    overwrittenFunctions: changedFunctions,
  };
}

/**
 * Fallback for a manifest written before `installedTemplates` existed
 * (schemaVersion 1 `init`, Task 18): recovers the same `<module>/<name>`
 * identity from the timestamped filenames already recorded in
 * `installedFiles`. Non-migration entries (function files) don't match the
 * pattern and are silently skipped.
 */
function reconstructInstalledTemplateIds(installedFiles: string[]): string[] {
  const ids: string[] = [];
  for (const f of installedFiles) {
    const parsed = parseMigrationDestFilename(path.basename(f));
    if (!parsed) continue;
    ids.push(migrationTemplateId(parsed.moduleName, parsed.name));
  }
  return ids;
}

function functionDirDiffers(srcDir: string, destDir: string): boolean {
  const srcRel = new Set(listFilesRecursive(srcDir).map((f) => path.relative(srcDir, f)));
  const destRel = new Set(listFilesRecursive(destDir).map((f) => path.relative(destDir, f)));
  if (srcRel.size !== destRel.size) return true;
  for (const rel of srcRel) {
    if (!destRel.has(rel)) return true;
    const a = fs.readFileSync(path.join(srcDir, rel));
    const b = fs.readFileSync(path.join(destDir, rel));
    if (!a.equals(b)) return true;
  }
  return false;
}

function printSummary(
  log: (message: string) => void,
  onWarn: (message: string) => void,
  summary: {
    addedModules: string[];
    addedMigrations: string[];
    newFunctions: string[];
    overwrittenFunctions: string[];
  },
): void {
  log("");
  log("community-sdk upgraded.");
  if (summary.addedModules.length > 0) {
    log(`Added module(s): ${summary.addedModules.join(", ")}`);
  }
  if (summary.addedMigrations.length > 0) {
    log(`Added ${summary.addedMigrations.length} migration(s):`);
    for (const f of summary.addedMigrations) log(`  ${f}`);
  }
  if (summary.newFunctions.length > 0) {
    log(`Added ${summary.newFunctions.length} function(s): ${summary.newFunctions.join(", ")}`);
  }
  if (summary.overwrittenFunctions.length > 0) {
    onWarn(
      `community-sdk: overwrote ${summary.overwrittenFunctions.length} function(s) with new template code — review before deploying: ${summary.overwrittenFunctions.join(", ")}`,
    );
  }
  log("Next steps:");
  if (summary.addedMigrations.length > 0) {
    log("  1. Review the new migrations, then: supabase db push");
  }
  if (summary.newFunctions.length > 0 || summary.overwrittenFunctions.length > 0) {
    log("  2. Review the function changes, then: supabase functions deploy");
  }
  if (summary.addedModules.includes("translation")) {
    log(
      '  3. translation module: COMMUNITY_TRANSLATION_LOCALES="en,es-419,..." (required, same list as modules.translation.locales in the app); optional: COMMUNITY_TRANSLATION_MODEL, COMMUNITY_TRANSLATION_STYLE',
    );
  }
}
