import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ALREADY_INITIALIZED_MESSAGE, runInit, type InitOptions } from "../commands/init";
import { readManifest } from "../manifest";

// The templates dir a real install ships as `packages/cli/templates/` (copied
// from the repo root by scripts/copy-templates.mjs at prebuild). Tests point
// straight at the repo-root supabase/ source of truth instead, so they don't
// depend on that build step having run.
const REPO_SUPABASE_DIR = path.resolve(__dirname, "..", "..", "..", "..", "supabase");

describe("runInit", () => {
  let cwd: string;
  const projectUrl = "https://testref.supabase.co";
  const anonKey = "test-anon-key";

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "community-sdk-init-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function baseOptions(overrides: Partial<InitOptions> = {}): InitOptions {
    return {
      cwd,
      templatesDir: REPO_SUPABASE_DIR,
      projectUrl,
      anonKey,
      now: new Date("2026-08-31T12:00:00Z"),
      log: () => {},
      ...overrides,
    };
  }

  it("copies only core migrations with --modules core", async () => {
    await runInit(baseOptions({ modules: ["core"] }));

    const files = fs.readdirSync(path.join(cwd, "supabase", "migrations")).sort();
    expect(files).toHaveLength(6);
    expect(files.every((f) => /^\d{14}_community_core_/.test(f))).toBe(true);
  });

  it("orders copied migrations core -> push -> polls -> reaction -> inbox", async () => {
    await runInit(baseOptions({ modules: ["core", "push", "polls", "reaction", "inbox"] }));

    const files = fs.readdirSync(path.join(cwd, "supabase", "migrations")).sort();
    const modulesInFileOrder = files.map((f) => f.split("_community_")[1]!.split("_")[0]);

    expect(modulesInFileOrder).toEqual([
      "core",
      "core",
      "core",
      "core",
      "core",
      "core",
      "push",
      "push",
      "polls",
      "reaction",
      "inbox",
    ]);
  });

  it("substitutes placeholders in the copied migration output", async () => {
    await runInit(baseOptions({ modules: ["core"] }));

    const migrationsDir = path.join(cwd, "supabase", "migrations");
    const moderationFile = fs.readdirSync(migrationsDir).find((f) => f.includes("_moderation.sql"))!;
    const content = fs.readFileSync(path.join(migrationsDir, moderationFile), "utf8");

    expect(content).toContain(projectUrl);
    expect(content).toContain(anonKey);
    expect(content).not.toContain("__SUPABASE");
  });

  it("writes a manifest with schemaVersion 1, sdkVersion, modules and installedFiles", async () => {
    const result = await runInit(baseOptions({ modules: ["core", "push"] }));

    const manifest = readManifest(cwd);
    expect(manifest).not.toBeNull();
    expect(manifest!.schemaVersion).toBe(1);
    expect(typeof manifest!.sdkVersion).toBe("string");
    expect(manifest!.modules).toEqual(["core", "push"]);
    expect(manifest!.installedFiles.length).toBeGreaterThan(0);
    expect(manifest!.installedFiles.every((f) => !path.isAbsolute(f))).toBe(true);
    expect(manifest).toEqual(result.manifest);
  });

  it("fails on a second init with an already-initialized error", async () => {
    await runInit(baseOptions({ modules: ["core"] }));

    await expect(runInit(baseOptions({ modules: ["core"] }))).rejects.toThrow(
      ALREADY_INITIALIZED_MESSAGE,
    );
  });

  it("implies core even when it is not explicitly selected", async () => {
    const result = await runInit(baseOptions({ modules: ["push"] }));
    expect(result.manifest.modules).toEqual(["core", "push"]);
  });

  it("warns when inbox is selected without reaction, but proceeds", async () => {
    const onWarn = vi.fn();
    const result = await runInit(baseOptions({ modules: ["core", "inbox"], onWarn }));

    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn.mock.calls[0]![0]).toMatch(/reaction/i);
    expect(result.manifest.modules).toEqual(["core", "inbox"]);
  });

  it("does not warn when both reaction and inbox are selected", async () => {
    const onWarn = vi.fn();
    await runInit(baseOptions({ modules: ["core", "reaction", "inbox"], onWarn }));
    expect(onWarn).not.toHaveBeenCalled();
  });

  it("copies only the always-on functions with --modules core", async () => {
    await runInit(baseOptions({ modules: ["core"] }));

    const fnDirs = fs.readdirSync(path.join(cwd, "supabase", "functions")).sort();
    expect(fnDirs).toEqual([
      "_shared",
      "daily-moderation",
      "moderate-one",
      "report-to-slack",
      "update-profile",
    ]);
  });

  it("copies all 8 functions + _shared when every module is selected", async () => {
    await runInit(baseOptions({ modules: ["core", "push", "polls", "reaction", "inbox"] }));

    const fnDirs = fs.readdirSync(path.join(cwd, "supabase", "functions")).sort();
    expect(fnDirs).toEqual([
      "_shared",
      "broadcast-post",
      "daily-moderation",
      "moderate-one",
      "notify-comment",
      "notify-like",
      "notify-reaction",
      "report-to-slack",
      "update-profile",
    ]);
  });

  it("copies push functions with push but not reaction functions", async () => {
    await runInit(baseOptions({ modules: ["core", "push"] }));

    const fnDirs = fs.readdirSync(path.join(cwd, "supabase", "functions")).sort();
    expect(fnDirs).toContain("notify-like");
    expect(fnDirs).toContain("notify-comment");
    expect(fnDirs).toContain("broadcast-post");
    expect(fnDirs).not.toContain("notify-reaction");
  });

  it("derives the project URL from <dir>/config.toml when not passed explicitly", async () => {
    const supabaseDir = path.join(cwd, "supabase");
    fs.mkdirSync(supabaseDir, { recursive: true });
    fs.writeFileSync(path.join(supabaseDir, "config.toml"), 'project_id = "my-proj-ref"\n');

    const prompt = vi.fn().mockResolvedValue(anonKey);
    await runInit(baseOptions({ modules: ["core"], projectUrl: undefined, anonKey: undefined, prompt }));

    const migrationsDir = path.join(supabaseDir, "migrations");
    const moderationFile = fs.readdirSync(migrationsDir).find((f) => f.includes("_moderation.sql"))!;
    const content = fs.readFileSync(path.join(migrationsDir, moderationFile), "utf8");

    expect(content).toContain("https://my-proj-ref.supabase.co");
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("prompts for missing project url and anon key, in that order", async () => {
    const prompt = vi.fn().mockResolvedValueOnce(projectUrl).mockResolvedValueOnce(anonKey);

    await runInit(
      baseOptions({ modules: ["core"], projectUrl: undefined, anonKey: undefined, prompt }),
    );

    expect(prompt).toHaveBeenCalledTimes(2);
    const [firstQuestion] = prompt.mock.calls[0]!;
    const [secondQuestion] = prompt.mock.calls[1]!;
    expect(firstQuestion).toMatch(/project url/i);
    expect(secondQuestion).toMatch(/anon key/i);
  });

  it("prints next steps mentioning db push, secrets and functions deploy", async () => {
    const lines: string[] = [];
    await runInit(baseOptions({ modules: ["core"], log: (m) => lines.push(m) }));

    const output = lines.join("\n");
    expect(output).toMatch(/db push/i);
    expect(output).toContain("OPENAI_API_KEY");
    expect(output).toMatch(/functions deploy/i);
  });

  it("fails loudly instead of hanging when stdin is not a TTY and flags are missing", async () => {
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;
    try {
      await expect(
        runInit(
          baseOptions({
            modules: ["core"],
            projectUrl: undefined,
            anonKey: undefined,
            prompt: undefined,
          }),
        ),
      ).rejects.toThrow(/--project-url.*--anon-key|not a TTY/i);

      // Nothing should have been written: the check must fire before any copy.
      expect(fs.existsSync(path.join(cwd, "supabase"))).toBe(false);
      expect(readManifest(cwd)).toBeNull();
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });

  it("does not block on a non-TTY stdin when a prompt function is injected", async () => {
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;
    try {
      const prompt = vi.fn().mockResolvedValueOnce(projectUrl).mockResolvedValueOnce(anonKey);
      const result = await runInit(
        baseOptions({ modules: ["core"], projectUrl: undefined, anonKey: undefined, prompt }),
      );
      expect(prompt).toHaveBeenCalledTimes(2);
      expect(result.manifest.modules).toEqual(["core"]);
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });

  it("rejects a --dir that escapes the project root", async () => {
    await expect(runInit(baseOptions({ modules: ["core"], dir: "../escape" }))).rejects.toThrow(
      /--dir/,
    );
    // Nothing should have been written outside (or inside) the temp root.
    expect(fs.existsSync(path.join(cwd, "..", "escape"))).toBe(false);
  });

  it("rolls back partially written files and names the source file when a mid-install copy fails", async () => {
    const brokenTemplatesDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "community-sdk-broken-templates-"),
    );
    try {
      const migrationsRoot = path.join(brokenTemplatesDir, "migrations");
      fs.mkdirSync(path.join(migrationsRoot, "core"), { recursive: true });
      fs.mkdirSync(path.join(migrationsRoot, "push"), { recursive: true });
      fs.mkdirSync(path.join(brokenTemplatesDir, "functions"), { recursive: true });

      fs.writeFileSync(path.join(migrationsRoot, "core", "001_a.sql"), "select 1;\n");
      fs.writeFileSync(path.join(migrationsRoot, "core", "002_b.sql"), "select 2;\n");
      // This file carries a placeholder substitutePlaceholders doesn't know
      // how to fill, so it throws partway through the push module — after
      // two core migrations have already been written to disk.
      fs.writeFileSync(
        path.join(migrationsRoot, "push", "001_broken.sql"),
        "-- __SUPABASE_BROKEN__ placeholder\n",
      );

      let caught: unknown;
      try {
        await runInit(
          baseOptions({ modules: ["core", "push"], templatesDir: brokenTemplatesDir }),
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).toContain("__SUPABASE");
      expect(message).toContain("push/001_broken.sql");

      // Rollback: the migrations dir we created fresh must be gone entirely,
      // and no manifest should exist for a retry to trip over.
      expect(fs.existsSync(path.join(cwd, "supabase", "migrations"))).toBe(false);
      expect(readManifest(cwd)).toBeNull();
    } finally {
      fs.rmSync(brokenTemplatesDir, { recursive: true, force: true });
    }
  });
});
