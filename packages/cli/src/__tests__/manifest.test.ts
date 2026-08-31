import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readManifest, writeManifest, type Manifest } from "../manifest";

describe("manifest", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "community-sdk-manifest-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no manifest file exists", () => {
    expect(readManifest(dir)).toBeNull();
  });

  it("round-trips through writeManifest/readManifest", () => {
    const manifest: Manifest = {
      schemaVersion: 1,
      sdkVersion: "0.0.0",
      modules: ["core", "push"],
      installedFiles: ["supabase/migrations/x.sql", "supabase/functions/_shared/config.ts"],
    };

    writeManifest(dir, manifest);

    expect(fs.existsSync(path.join(dir, "community-sdk.json"))).toBe(true);
    expect(readManifest(dir)).toEqual(manifest);
  });

  it("overwrites a previous manifest on a second write", () => {
    writeManifest(dir, { schemaVersion: 1, sdkVersion: "0.0.0", modules: ["core"], installedFiles: [] });
    writeManifest(dir, {
      schemaVersion: 1,
      sdkVersion: "0.1.0",
      modules: ["core", "push"],
      installedFiles: ["a"],
    });

    expect(readManifest(dir)).toEqual({
      schemaVersion: 1,
      sdkVersion: "0.1.0",
      modules: ["core", "push"],
      installedFiles: ["a"],
    });
  });

  it("throws a clear error when community-sdk.json is corrupt", () => {
    fs.writeFileSync(path.join(dir, "community-sdk.json"), "{ not valid json");
    expect(() => readManifest(dir)).toThrow(/corrupt/i);
  });
});
