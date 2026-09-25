import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runInit } from "../commands/init";
import { NOT_INITIALIZED_MESSAGE, runUpgrade, type UpgradeOptions } from "../commands/upgrade";
import { readManifest, writeManifest } from "../manifest";

// The templates dir a real install ships as `packages/cli/templates/` (copied
// from the repo root by scripts/copy-templates.mjs at prebuild). Tests point
// straight at the repo-root supabase/ source of truth instead, so they don't
// depend on that build step having run.
const REPO_SUPABASE_DIR = path.resolve(__dirname, "..", "..", "..", "..", "supabase");

function copyTemplates(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "community-sdk-upgrade-templates-"));
  fs.cpSync(REPO_SUPABASE_DIR, dir, { recursive: true });
  return dir;
}

describe("runUpgrade", () => {
  let cwd: string;
  let templatesDir: string;
  const projectUrl = "https://testref.supabase.co";
  const anonKey = "test-anon-key";

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "community-sdk-upgrade-"));
    templatesDir = copyTemplates();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(templatesDir, { recursive: true, force: true });
  });

  function baseOptions(overrides: Partial<UpgradeOptions> = {}): UpgradeOptions {
    return {
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      now: new Date("2026-09-15T09:00:00Z"),
      log: () => {},
      ...overrides,
    };
  }

  it("refuses to run without a manifest", async () => {
    await expect(runUpgrade(baseOptions())).rejects.toThrow(NOT_INITIALIZED_MESSAGE);
    // Nothing should have been written.
    expect(fs.existsSync(path.join(cwd, "supabase"))).toBe(false);
  });

  it("is a no-op on an up-to-date manifest", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    const manifestBefore = readManifest(cwd);
    const migrationsBefore = fs.readdirSync(path.join(cwd, "supabase", "migrations")).sort();

    const lines: string[] = [];
    const result = await runUpgrade(baseOptions({ log: (m) => lines.push(m) }));

    expect(result.upToDate).toBe(true);
    expect(lines.join("\n")).toMatch(/already up to date/i);
    expect(readManifest(cwd)).toEqual(manifestBefore);
    expect(fs.readdirSync(path.join(cwd, "supabase", "migrations")).sort()).toEqual(
      migrationsBefore,
    );
  });

  it("copies exactly a newly added template migration, timestamped after the existing ones", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    const migrationsDir = path.join(cwd, "supabase", "migrations");
    const before = fs.readdirSync(migrationsDir).sort();
    expect(before).toHaveLength(7);

    // Simulate a newer SDK version shipping one additional core migration.
    fs.writeFileSync(
      path.join(templatesDir, "migrations", "core", "999_new_thing.sql"),
      "select 1;\n",
    );

    const result = await runUpgrade(baseOptions());

    const after = fs.readdirSync(migrationsDir).sort();
    expect(after).toHaveLength(8);

    const newFiles = after.filter((f) => !before.includes(f));
    expect(newFiles).toHaveLength(1);
    const newFile = newFiles[0]!;
    expect(newFile).toMatch(/^\d{14}_community_core_new_thing\.sql$/);

    // Timestamped after every pre-existing migration.
    const maxBeforeTimestamp = Math.max(...before.map((f) => Number(f.slice(0, 14))));
    expect(Number(newFile.slice(0, 14))).toBeGreaterThan(maxBeforeTimestamp);

    // Pre-existing migrations are untouched.
    expect(after.filter((f) => before.includes(f))).toEqual(before);

    expect(result.upToDate).toBe(false);
    expect(result.addedMigrations).toHaveLength(1);
    expect(result.addedMigrations[0]).toContain(newFile);

    const manifest = readManifest(cwd);
    expect(manifest!.installedTemplates).toContain("core/new_thing");
  });

  it("overwrites a changed function with a warning naming it", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    const fnPath = path.join(templatesDir, "functions", "moderate-one", "index.ts");
    const original = fs.readFileSync(fnPath, "utf8");
    fs.writeFileSync(fnPath, `${original}\n// upgraded behavior\n`);

    const onWarn = vi.fn();
    const result = await runUpgrade(baseOptions({ onWarn }));

    expect(result.overwrittenFunctions).toEqual(["moderate-one"]);
    expect(onWarn).toHaveBeenCalled();
    const warned = onWarn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain("moderate-one");

    const installedContent = fs.readFileSync(
      path.join(cwd, "supabase", "functions", "moderate-one", "index.ts"),
      "utf8",
    );
    expect(installedContent).toContain("// upgraded behavior");

    // No migrations were added — only the function content changed.
    expect(result.addedMigrations).toHaveLength(0);
    expect(result.upToDate).toBe(false);
  });

  it("treats a host's leftover *_test.ts as no diff, and keeps the manifest's modules as they are", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core", "push"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });
    // A host installed by an older CLI still has the test file.
    fs.writeFileSync(
      path.join(cwd, "supabase", "functions", "_shared", "translation_test.ts"),
      "// old copy\n",
    );
    // Hand-ordered module list; a plain upgrade must not re-canonicalize it.
    const manifest = readManifest(cwd)!;
    writeManifest(cwd, { ...manifest, modules: ["push", "core"] });
    fs.writeFileSync(
      path.join(templatesDir, "migrations", "core", "999_new_thing.sql"),
      "select 1;\n",
    );

    const result = await runUpgrade(baseOptions());

    expect(result.overwrittenFunctions).toEqual([]);
    expect(result.addedMigrations).toHaveLength(1);
    expect(readManifest(cwd)!.modules).toEqual(["push", "core"]);
  });

  it("does not warn or touch functions whose template content is unchanged", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    fs.writeFileSync(
      path.join(templatesDir, "migrations", "core", "999_new_thing.sql"),
      "select 1;\n",
    );

    const onWarn = vi.fn();
    const result = await runUpgrade(baseOptions({ onWarn }));

    expect(result.overwrittenFunctions).toEqual([]);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it("substitutes placeholders in a newly added migration that carries one", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    fs.writeFileSync(
      path.join(templatesDir, "migrations", "core", "999_needs_secret.sql"),
      "-- __SUPABASE_PROJECT_URL__ / __SUPABASE_ANON_KEY__\nselect 1;\n",
    );

    await runUpgrade(baseOptions());

    const migrationsDir = path.join(cwd, "supabase", "migrations");
    const newFile = fs.readdirSync(migrationsDir).find((f) => f.includes("needs_secret"))!;
    const content = fs.readFileSync(path.join(migrationsDir, newFile), "utf8");

    expect(content).toContain(projectUrl);
    expect(content).toContain(anonKey);
    expect(content).not.toContain("__SUPABASE");
  });

  it("prompts for missing credentials only when a pending migration needs them", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    fs.writeFileSync(
      path.join(templatesDir, "migrations", "core", "999_new_thing.sql"),
      "select 1;\n",
    );

    const prompt = vi.fn();
    const result = await runUpgrade(
      baseOptions({ projectUrl: undefined, anonKey: undefined, prompt }),
    );

    expect(prompt).not.toHaveBeenCalled();
    expect(result.addedMigrations).toHaveLength(1);
  });

  it("copies a brand-new function required by the currently installed modules", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core", "push"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    // Simulate the function having been removed locally (e.g. a user deleted
    // it, or an older CLI never installed it) so upgrade must re-add it.
    fs.rmSync(path.join(cwd, "supabase", "functions", "notify-like"), {
      recursive: true,
      force: true,
    });

    const result = await runUpgrade(baseOptions());

    expect(result.newFunctions).toContain("notify-like");
    expect(result.overwrittenFunctions).not.toContain("notify-like");
    expect(fs.existsSync(path.join(cwd, "supabase", "functions", "notify-like", "index.ts"))).toBe(
      true,
    );
  });

  it("falls back to reconstructing template identity from installedFiles for a pre-upgrade manifest", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    // Simulate a manifest written by the schemaVersion-1 `init` that shipped
    // before `installedTemplates` existed (Task 18).
    const manifest = readManifest(cwd)!;
    const { installedTemplates: _drop, ...legacyManifest } = manifest;
    writeManifest(cwd, legacyManifest as typeof manifest);

    const lines: string[] = [];
    const result = await runUpgrade(baseOptions({ log: (m) => lines.push(m) }));

    // Nothing actually changed in the template tree, so this must still be
    // recognized as up to date rather than re-copying every core migration.
    expect(result.upToDate).toBe(true);
    expect(lines.join("\n")).toMatch(/already up to date/i);
  });

  it("rejects a --dir that escapes the project root", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    await expect(runUpgrade(baseOptions({ dir: "../escape" }))).rejects.toThrow(/--dir/);
  });

  it("adds a module: copies its migrations after the existing ones, its functions, and persists it in the manifest", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core", "polls"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    const migrationsDir = path.join(cwd, "supabase", "migrations");
    const before = fs.readdirSync(migrationsDir).sort();
    const maxBeforeTimestamp = Math.max(...before.map((f) => Number(f.slice(0, 14))));

    const result = await runUpgrade(baseOptions({ addModules: ["translation"] }));

    expect(result.addedModules).toEqual(["translation"]);

    const after = fs.readdirSync(migrationsDir).sort();
    const translationFiles = after.filter((f) => f.includes("_community_translation_"));
    expect(translationFiles).toHaveLength(1);
    expect(Number(translationFiles[0]!.slice(0, 14))).toBeGreaterThan(maxBeforeTimestamp);

    expect(fs.existsSync(path.join(cwd, "supabase", "functions", "translate-one"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, "supabase", "functions", "daily-translation"))).toBe(true);

    const manifest = readManifest(cwd)!;
    expect(manifest.modules).toEqual(["core", "polls", "translation"]);
    expect(manifest.installedTemplates).toContain("translation/translations");
  });

  it("warns when adding translation without polls", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    const onWarn = vi.fn();
    const result = await runUpgrade(baseOptions({ addModules: ["translation"], onWarn }));

    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(String(onWarn.mock.calls[0]![0])).toMatch(/poll/i);
    expect(result.upToDate).toBe(false);
    expect(result.addedModules).toEqual(["translation"]);
  });

  it("rejects an unknown module name and writes nothing", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    const migrationsDir = path.join(cwd, "supabase", "migrations");
    const before = fs.readdirSync(migrationsDir).sort();
    const manifestBefore = readManifest(cwd);

    await expect(runUpgrade(baseOptions({ addModules: ["nope"] }))).rejects.toThrow(
      /unknown module/,
    );

    expect(fs.readdirSync(migrationsDir).sort()).toEqual(before);
    expect(readManifest(cwd)).toEqual(manifestBefore);
  });

  it("adding an already-installed module is a no-op", async () => {
    await runInit({
      cwd,
      templatesDir,
      projectUrl,
      anonKey,
      modules: ["core", "polls"],
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
    });

    const result = await runUpgrade(baseOptions({ addModules: ["polls"] }));

    expect(result.upToDate).toBe(true);
    expect(result.addedModules).toEqual([]);
  });
});
