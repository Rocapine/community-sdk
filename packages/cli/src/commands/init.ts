import * as fs from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { substitutePlaceholders } from "../substitute";
import { readManifest, writeManifest, type Manifest } from "../manifest";

/**
 * Ruled install order (controller ruling, task 18): core -> push -> polls ->
 * reaction -> inbox. Reaction MUST land before inbox — inbox/001's reaction
 * trigger is guarded with `to_regclass('public.post_reactions')` at install
 * time and is never retroactively wired if the reaction module shows up
 * later, so `reaction` needs to already exist when `inbox` runs.
 */
export const MODULE_ORDER = ["core", "push", "polls", "reaction", "inbox"] as const;
export type Module = (typeof MODULE_ORDER)[number];

const ALWAYS_FUNCTIONS = [
  "moderate-one",
  "daily-moderation",
  "update-profile",
  "report-to-slack",
  "_shared",
];
const PUSH_FUNCTIONS = ["notify-like", "notify-comment", "broadcast-post"];
const REACTION_FUNCTIONS = ["notify-reaction"];

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
  const cwdResolved = path.resolve(cwd);
  const dir = path.resolve(cwdResolved, dirRel);
  if (dir !== cwdResolved && !dir.startsWith(cwdResolved + path.sep)) {
    throw new Error(
      `community-sdk: --dir must resolve to a directory inside the project root, got "${dirRel}" -> ${dir}`,
    );
  }

  const templatesDir = options.templatesDir ?? defaultTemplatesDir();

  const migrationsSrcRoot = path.join(templatesDir, "migrations");
  const functionsSrcRoot = path.join(templatesDir, "functions");
  if (!fs.existsSync(migrationsSrcRoot) || !fs.existsSync(functionsSrcRoot)) {
    throw new Error(
      `community-sdk: templates not found at ${templatesDir} (expected migrations/ and functions/ subdirectories)`,
    );
  }

  const usingDefaultPrompt = !options.prompt;
  const prompt = options.prompt ?? defaultPrompt;
  let projectUrl = options.projectUrl;
  let anonKey = options.anonKey;

  if (!projectUrl) {
    projectUrl = deriveProjectUrlFromConfig(dir) ?? undefined;
  }

  const stillMissingFlags: string[] = [];
  if (!projectUrl) stillMissingFlags.push("--project-url");
  if (!anonKey) stillMissingFlags.push("--anon-key");

  if (stillMissingFlags.length > 0 && usingDefaultPrompt && !process.stdin.isTTY) {
    throw new Error(
      `community-sdk: missing required flag(s) ${stillMissingFlags.join(", ")}. stdin is not a TTY, so init cannot prompt for ${
        stillMissingFlags.length > 1 ? "them" : "it"
      } — pass ${stillMissingFlags.length > 1 ? "them" : "it"} explicitly.`,
    );
  }

  if (!projectUrl) {
    projectUrl = (await prompt("Supabase project URL (https://<ref>.supabase.co): ")).trim();
  }
  if (!anonKey) {
    anonKey = (await prompt("Supabase anon key: ")).trim();
  }

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
        const name = filename.replace(/\.sql$/, "").replace(/^\d+_/, "");
        const timestamp = formatTimestamp(addSeconds(now, fileIndex));
        fileIndex += 1;

        const destFilename = `${timestamp}_community_${moduleName}_${name}.sql`;
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
    schemaVersion: 1,
    sdkVersion: readOwnPackageVersion(),
    modules: canonicalModules,
    installedFiles: writtenPaths.map((f) => toRelativePosix(cwd, f)).sort(),
  };
  writeManifest(cwd, manifest);

  printNextSteps(log, canonicalModules);

  return { manifest, dir };
}

function resolveModules(requested: string[] | undefined, onWarn: (message: string) => void): Module[] {
  const source = requested && requested.length > 0 ? requested : [...MODULE_ORDER];
  const requestedSet = new Set(source.map((m) => m.trim()).filter(Boolean));

  for (const m of requestedSet) {
    if (!(MODULE_ORDER as readonly string[]).includes(m)) {
      throw new Error(
        `community-sdk: unknown module "${m}" (expected one of ${MODULE_ORDER.join(", ")})`,
      );
    }
  }

  // core is always required/implied.
  requestedSet.add("core");

  const canonicalModules = MODULE_ORDER.filter((m) => requestedSet.has(m));

  if (canonicalModules.includes("inbox") && !canonicalModules.includes("reaction")) {
    onWarn(
      "community-sdk: module 'inbox' selected without 'reaction' — reaction notifications won't appear in the inbox until the reaction module is also installed.",
    );
  }

  return canonicalModules;
}

function functionsForModules(modules: Module[]): string[] {
  const set = new Set<string>(ALWAYS_FUNCTIONS);
  if (modules.includes("push")) for (const f of PUSH_FUNCTIONS) set.add(f);
  if (modules.includes("reaction")) for (const f of REACTION_FUNCTIONS) set.add(f);
  return [...set];
}

function defaultTemplatesDir(): string {
  // Both src/commands/init.ts and lib/commands/init.js sit two levels below
  // the package root (packages/cli), so this resolves identically pre- and
  // post-build.
  const packageRoot = path.resolve(__dirname, "..", "..");
  const packaged = path.join(packageRoot, "templates");
  // STALENESS TRAP: once packages/cli/templates/ exists on disk (written by
  // any prior `pnpm build`, whose `prebuild` hook runs
  // scripts/copy-templates.mjs), it wins over the live repo-root supabase/
  // tree below — even during local dev. Editing supabase/**/*.sql or
  // supabase/functions/** and then running `node lib/index.js init` (or a
  // test that doesn't pass an explicit `templatesDir`) will silently use the
  // last-built snapshot, not your edits. Rerun `pnpm build` (or `node
  // scripts/copy-templates.mjs` directly) to refresh packages/cli/templates/
  // after touching supabase/.
  if (fs.existsSync(packaged)) return packaged;

  // Dev/test fallback: the monorepo's own supabase/ source of truth, used
  // only while packages/cli/templates/ has never been built.
  const repoRoot = path.resolve(packageRoot, "..", "..");
  return path.join(repoRoot, "supabase");
}

function readOwnPackageVersion(): string {
  const packageRoot = path.resolve(__dirname, "..", "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

function deriveProjectUrlFromConfig(dir: string): string | null {
  const configPath = path.join(dir, "config.toml");
  if (!fs.existsSync(configPath)) return null;
  const raw = fs.readFileSync(configPath, "utf8");
  const match = raw.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
  if (!match) return null;
  return `https://${match[1]}.supabase.co`;
}

function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(question).then((answer) => {
    rl.close();
    return answer;
  });
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    String(date.getUTCFullYear()) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function listFilesRecursive(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function toRelativePosix(base: string, target: string): string {
  return path.relative(base, target).split(path.sep).join("/");
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
