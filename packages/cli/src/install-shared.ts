import * as fs from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";

/**
 * Ruled install order (controller ruling, task 18): core -> push -> polls ->
 * reaction -> inbox. Reaction MUST land before inbox — inbox/001's reaction
 * trigger is guarded with `to_regclass('public.post_reactions')` at install
 * time and is never retroactively wired if the reaction module shows up
 * later, so `reaction` needs to already exist when `inbox` runs.
 *
 * Shared between `init` (task 18) and `upgrade`/`adopt` (task 19) — the
 * single source of truth for module names, order, and the function sets
 * each module pulls in.
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

export function functionsForModules(modules: readonly Module[]): string[] {
  const set = new Set<string>(ALWAYS_FUNCTIONS);
  if (modules.includes("push")) for (const f of PUSH_FUNCTIONS) set.add(f);
  if (modules.includes("reaction")) for (const f of REACTION_FUNCTIONS) set.add(f);
  return [...set];
}

/**
 * Validates and canonicalizes a requested module list: rejects unknown
 * names, always implies `core`, orders the result per MODULE_ORDER, and
 * warns (non-fatally) when `inbox` is picked without `reaction`.
 */
export function resolveModules(
  requested: string[] | undefined,
  onWarn: (message: string) => void,
): Module[] {
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

/**
 * Strips a template migration's leading numeric ordering prefix and `.sql`
 * extension, e.g. "001_tables.sql" -> "tables". This is both the middle
 * segment of the timestamped destination filename init/upgrade write
 * (`<ts>_community_<module>_<name>.sql`) AND — paired with the module name —
 * the stable identity `upgrade` diffs against (see manifest.ts
 * `migrationTemplateId`).
 */
export function templateBaseName(templateFilename: string): string {
  return templateFilename.replace(/\.sql$/, "").replace(/^\d+_/, "");
}

export function migrationDestFilename(timestamp: string, moduleName: string, name: string): string {
  return `${timestamp}_community_${moduleName}_${name}.sql`;
}

const MIGRATION_DEST_RE = /^\d{14}_community_([a-z]+)_(.+)\.sql$/;

/**
 * Parses a filename previously written by init/upgrade
 * (`<ts>_community_<module>_<name>.sql`) back into its module + base name.
 * Returns null for anything else (e.g. a function file, or a migration a
 * user hand-wrote outside the SDK) — used by `upgrade` as a fallback when
 * reconstructing template identity from a manifest that predates the
 * `installedTemplates` field.
 */
export function parseMigrationDestFilename(
  filename: string,
): { moduleName: string; name: string } | null {
  const match = MIGRATION_DEST_RE.exec(filename);
  if (!match) return null;
  return { moduleName: match[1]!, name: match[2]! };
}

export function defaultTemplatesDir(): string {
  // This file and src/commands/*.ts both sit two levels below the package
  // root (packages/cli), so this resolves identically pre- and post-build.
  const packageRoot = path.resolve(__dirname, "..");
  const packaged = path.join(packageRoot, "templates");
  // STALENESS TRAP: once packages/cli/templates/ exists on disk (written by
  // any prior `npm run build`, whose `prebuild` hook runs
  // scripts/copy-templates.mjs), it wins over the live repo-root supabase/
  // tree below — even during local dev. Editing supabase/**/*.sql or
  // supabase/functions/** and then running `node lib/index.js init` (or a
  // test that doesn't pass an explicit `templatesDir`) will silently use the
  // last-built snapshot, not your edits. Rerun `npm run build` (or `node
  // scripts/copy-templates.mjs` directly) to refresh packages/cli/templates/
  // after touching supabase/.
  if (fs.existsSync(packaged)) return packaged;

  // Dev/test fallback: the monorepo's own supabase/ source of truth, used
  // only while packages/cli/templates/ has never been built.
  const repoRoot = path.resolve(packageRoot, "..", "..");
  return path.join(repoRoot, "supabase");
}

/** Asserts `templatesDir` looks like a real template tree and returns its two roots. */
export function resolveTemplateRoots(templatesDir: string): {
  migrationsSrcRoot: string;
  functionsSrcRoot: string;
} {
  const migrationsSrcRoot = path.join(templatesDir, "migrations");
  const functionsSrcRoot = path.join(templatesDir, "functions");
  if (!fs.existsSync(migrationsSrcRoot) || !fs.existsSync(functionsSrcRoot)) {
    throw new Error(
      `community-sdk: templates not found at ${templatesDir} (expected migrations/ and functions/ subdirectories)`,
    );
  }
  return { migrationsSrcRoot, functionsSrcRoot };
}

export function readOwnPackageVersion(): string {
  const packageRoot = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

export function deriveProjectUrlFromConfig(dir: string): string | null {
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

/**
 * Resolves the Supabase project URL + anon key from (in order) explicit
 * flags, `<dir>/config.toml` (URL only), or an interactive prompt — failing
 * loudly instead of hanging when stdin is not a TTY and no `prompt`
 * override was injected. Shared by `init` and `upgrade`, both of which only
 * need this when a placeholder-bearing file is about to be written.
 */
export async function resolveProjectCredentials(options: {
  dir: string;
  projectUrl?: string;
  anonKey?: string;
  prompt?: (question: string) => Promise<string>;
}): Promise<{ projectUrl: string; anonKey: string }> {
  const usingDefaultPrompt = !options.prompt;
  const prompt = options.prompt ?? defaultPrompt;
  let projectUrl = options.projectUrl;
  let anonKey = options.anonKey;

  if (!projectUrl) {
    projectUrl = deriveProjectUrlFromConfig(options.dir) ?? undefined;
  }

  const stillMissingFlags: string[] = [];
  if (!projectUrl) stillMissingFlags.push("--project-url");
  if (!anonKey) stillMissingFlags.push("--anon-key");

  if (stillMissingFlags.length > 0 && usingDefaultPrompt && !process.stdin.isTTY) {
    throw new Error(
      `community-sdk: missing required flag(s) ${stillMissingFlags.join(", ")}. stdin is not a TTY, so this command cannot prompt for ${
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

  return { projectUrl, anonKey };
}

export function formatTimestamp(date: Date): string {
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

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function listFilesRecursive(dir: string): string[] {
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

export function toRelativePosix(base: string, target: string): string {
  return path.relative(base, target).split(path.sep).join("/");
}

/** Resolves `dirRel` against `cwd`, throwing if it would escape the project root. */
export function resolveContainedDir(cwd: string, dirRel: string): string {
  const cwdResolved = path.resolve(cwd);
  const dir = path.resolve(cwdResolved, dirRel);
  if (dir !== cwdResolved && !dir.startsWith(cwdResolved + path.sep)) {
    throw new Error(
      `community-sdk: --dir must resolve to a directory inside the project root, got "${dirRel}" -> ${dir}`,
    );
  }
  return dir;
}
