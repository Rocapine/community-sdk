import * as fs from "node:fs";
import * as path from "node:path";

/**
 * community-sdk.json — written at the app repo root by `community init`
 * (and updated by a future `community upgrade`). Tracks what was installed
 * so a second `init` can refuse to run and a future `upgrade` knows what it
 * is diffing against.
 */
export type Manifest = {
  schemaVersion: number;
  sdkVersion: string;
  modules: string[];
  installedFiles: string[];
};

export const MANIFEST_FILENAME = "community-sdk.json";

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
