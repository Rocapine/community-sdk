import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ALREADY_INITIALIZED_MESSAGE_ADOPT, runAdopt, type AdoptOptions } from "../commands/adopt";
import { runInit } from "../commands/init";
import { runUpgrade } from "../commands/upgrade";
import { readManifest } from "../manifest";

const REPO_SUPABASE_DIR = path.resolve(__dirname, "..", "..", "..", "..", "supabase");

describe("runAdopt", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "community-sdk-adopt-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function baseOptions(overrides: Partial<AdoptOptions> = {}): AdoptOptions {
    return {
      cwd,
      schemaVersion: 1,
      modules: ["core", "push"],
      templatesDir: REPO_SUPABASE_DIR,
      log: () => {},
      ...overrides,
    };
  }

  it("writes a manifest without touching <dir>/migrations", async () => {
    const result = await runAdopt(baseOptions());

    const manifest = readManifest(cwd);
    expect(manifest).not.toBeNull();
    expect(manifest!.schemaVersion).toBe(1);
    expect(manifest!.modules).toEqual(["core", "push"]);
    expect(manifest!.installedFiles).toEqual([]);
    expect(manifest).toEqual(result.manifest);

    // Nothing was copied: the supabase/ dir this run would have written
    // migrations/functions into must not exist at all.
    expect(fs.existsSync(path.join(cwd, "supabase"))).toBe(false);
  });

  it("refuses when a manifest already exists", async () => {
    await runAdopt(baseOptions());
    await expect(runAdopt(baseOptions())).rejects.toThrow(ALREADY_INITIALIZED_MESSAGE_ADOPT);
  });

  it("also refuses when init already ran", async () => {
    await runInit({
      cwd,
      templatesDir: REPO_SUPABASE_DIR,
      projectUrl: "https://testref.supabase.co",
      anonKey: "test-anon-key",
      modules: ["core"],
      log: () => {},
    });
    await expect(runAdopt(baseOptions())).rejects.toThrow(ALREADY_INITIALIZED_MESSAGE_ADOPT);
  });

  it("rejects an unknown module", async () => {
    await expect(runAdopt(baseOptions({ modules: ["core", "not-a-module"] }))).rejects.toThrow(
      /unknown module/i,
    );
    expect(readManifest(cwd)).toBeNull();
  });

  it("implies core even when it is not explicitly listed", async () => {
    const result = await runAdopt(baseOptions({ modules: ["push"] }));
    expect(result.manifest.modules).toEqual(["core", "push"]);
  });

  it("rejects a non-positive-integer schema version", async () => {
    await expect(runAdopt(baseOptions({ schemaVersion: 0 }))).rejects.toThrow(/schema.version/i);
    await expect(runAdopt(baseOptions({ schemaVersion: 1.5 }))).rejects.toThrow(/schema.version/i);
  });

  it("prints a pointer to the compat table", async () => {
    const lines: string[] = [];
    await runAdopt(baseOptions({ log: (m) => lines.push(m) }));
    expect(lines.join("\n")).toMatch(/docs\/compat\.md/);
  });

  it("warns when the given schema version isn't the one this CLI currently knows", async () => {
    const onWarn = vi.fn();
    await runAdopt(baseOptions({ schemaVersion: 2, onWarn }));
    expect(onWarn).toHaveBeenCalled();
    expect(onWarn.mock.calls[0]![0]).toMatch(/compat/i);
  });

  it("rejects a --dir that escapes the project root", async () => {
    await expect(runAdopt(baseOptions({ dir: "../escape" }))).rejects.toThrow(/--dir/);
    expect(readManifest(cwd)).toBeNull();
  });

  it("marks the current template set for the selected modules as already installed, so upgrade adds no migrations for them", async () => {
    const result = await runAdopt(baseOptions({ modules: ["core"] }));

    const coreFiles = fs
      .readdirSync(path.join(REPO_SUPABASE_DIR, "migrations", "core"))
      .filter((f) => f.endsWith(".sql"));
    const expectedIds = coreFiles
      .map((f) => `core/${f.replace(/\.sql$/, "").replace(/^\d+_/, "")}`)
      .sort();

    expect(result.manifest.installedTemplates?.slice().sort()).toEqual(expectedIds);

    const upgradeResult = await runUpgrade({
      cwd,
      templatesDir: REPO_SUPABASE_DIR,
      projectUrl: "https://testref.supabase.co",
      anonKey: "test-anon-key",
      log: () => {},
    });

    // Functions still need to be seeded in (adopt copies nothing), but no
    // *migration* should be re-added for a schema that's already live.
    expect(upgradeResult.addedMigrations).toEqual([]);
  });
});
