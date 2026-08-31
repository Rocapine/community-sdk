import * as fs from "node:fs";
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
  listFilesRecursive,
  toRelativePosix,
  resolveContainedDir,
} from "../install-shared";

export { MODULE_ORDER, type Module };

export const ALREADY_INITIALIZED_MESSAGE =
  "community-sdk: already initialized (found community-sdk.json), use upgrade";

export interface InitOptions {
  /** Modules to install. Defaults to every module. `core` is always implied. */
  modules?: string[];
  projectUrl?: string;
  anonKey?: string;
  /** Target Supabase directory, relative to `cwd`. Defaults to "supabase". */
  dir?: string;
  /** App repo root — where community-sdk.json lives. Defaults to process.cwd(). */
  cwd?: string;
  /** Source of the migrations/ + functions/ trees. Defaults to the shipped templates. */
  templatesDir?: string;
  /** Used to ask for projectUrl/anonKey when missing and not derivable. */
  prompt?: (question: string) => Promise<string>;
  /** Called for non-fatal dependency warnings (e.g. inbox without reaction). */
  onWarn?: (message: string) => void;
  /** Used to print the summary + next steps. */
  log?: (message: string) => void;
  /** Clock override for deterministic migration timestamps in tests. */
  now?: Date;
}

export interface InitResult {
  manifest: Manifest;
  dir: string;
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? ((message: string) => console.log(message));
  const onWarn = options.onWarn ?? ((message: string) => console.warn(message));

  if (readManifest(cwd)) {
    throw new Error(ALREADY_INITIALIZED_MESSAGE);
  }

  const canonicalModules = resolveModules(options.modules, onWarn);

  const dirRel = options.dir ?? "supabase";
  const dir = resolveContainedDir(cwd, dirRel);

  const templatesDir = options.templatesDir ?? defaultTemplatesDir();
  const { migrationsSrcRoot, functionsSrcRoot } = resolveTemplateRoots(templatesDir);

  const { projectUrl, anonKey } = await resolveProjectCredentials({
    dir,
    projectUrl: options.projectUrl,
    anonKey: options.anonKey,
    prompt: options.prompt,
  });

  const now = options.now ?? new Date();

  // ---- migrations + functions, staged atomically: on any failure partway
  // through, every file this run wrote (which may already contain the real
  // project URL / anon key) is removed before the error propagates, so a
  // retry starts clean instead of finding stale/duplicate files and no
  // manifest to explain them. The manifest itself is written last, only once
  // every file below has landed successfully.
  const migrationsDestRoot = path.join(dir, "migrations");
  const functionsDestRoot = path.join(dir, "functions");
  const migrationsDestRootExisted = fs.existsSync(migrationsDestRoot);
  const functionsDestRootExisted = fs.existsSync(functionsDestRoot);
  const writtenPaths: string[] = [];
  const installedTemplates: string[] = [];

  try {
    // ---- migrations ----
    fs.mkdirSync(migrationsDestRoot, { recursive: true });

    let fileIndex = 0;
    for (const moduleName of canonicalModules) {
      const moduleSrcDir = path.join(migrationsSrcRoot, moduleName);
      const filenames = fs
        .readdirSync(moduleSrcDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

      for (const filename of filenames) {
        const name = templateBaseName(filename);
        const timestamp = formatTimestamp(addSeconds(now, fileIndex));
        fileIndex += 1;

        const destFilename = migrationDestFilename(timestamp, moduleName, name);
        const rawSql = fs.readFileSync(path.join(moduleSrcDir, filename), "utf8");

        let substituted: string;
        try {
          substituted = substitutePlaceholders(rawSql, { projectUrl, anonKey });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`${message} (source: ${moduleName}/${filename})`);
        }

        const destPath = path.join(migrationsDestRoot, destFilename);
        fs.writeFileSync(destPath, substituted, "utf8");
        writtenPaths.push(destPath);
        installedTemplates.push(migrationTemplateId(moduleName, name));
      }
    }

    // ---- functions ----
    fs.mkdirSync(functionsDestRoot, { recursive: true });

    for (const fnName of functionsForModules(canonicalModules)) {
      const srcDir = path.join(functionsSrcRoot, fnName);
      if (!fs.existsSync(srcDir)) continue;
      const destDir = path.join(functionsDestRoot, fnName);
      fs.cpSync(srcDir, destDir, { recursive: true });
      writtenPaths.push(...listFilesRecursive(destDir));
    }
  } catch (err) {
    for (const p of writtenPaths) {
      fs.rmSync(p, { force: true });
    }
    if (!functionsDestRootExisted) {
      fs.rmSync(functionsDestRoot, { recursive: true, force: true });
    }
    if (!migrationsDestRootExisted) {
      fs.rmSync(migrationsDestRoot, { recursive: true, force: true });
    }
    throw err;
  }

  // ---- manifest ----
  const manifest: Manifest = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sdkVersion: readOwnPackageVersion(),
    modules: canonicalModules,
    installedFiles: writtenPaths.map((f) => toRelativePosix(cwd, f)).sort(),
    installedTemplates: installedTemplates.sort(),
  };
  writeManifest(cwd, manifest);

  printNextSteps(log, canonicalModules);

  return { manifest, dir };
}

function printNextSteps(log: (message: string) => void, modules: Module[]): void {
  log("");
  log(`community-sdk initialized (${modules.join(", ")}).`);
  log("Next steps:");
  log("  1. Review the copied migrations, then: supabase db push");
  log("  2. Set Edge Function secrets: supabase secrets set OPENAI_API_KEY=...");
  log("     optional: SLACK_WEBHOOK_URL, COMMUNITY_APP_NAME, COMMUNITY_FALLBACK_NAME");
  if (modules.includes("push")) {
    log("     push module: EXPO_ACCESS_TOKEN (required for notify-like/notify-comment)");
  }
  log("  3. Deploy the Edge Functions: supabase functions deploy");
}
