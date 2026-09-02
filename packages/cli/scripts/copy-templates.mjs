#!/usr/bin/env node
// Copies the repo-root supabase/ tree (the source of truth for migrations +
// Edge Functions) into packages/cli/templates/, so the published npm
// package can ship them without the whole monorepo. Run automatically via
// the "prebuild" script — see packages/cli/package.json.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

const source = path.join(repoRoot, "supabase");
const dest = path.join(packageRoot, "templates");

if (!existsSync(source)) {
  console.error(`copy-templates: source not found at ${source}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
// Skip dotted entries: `supabase link` drops a local .temp/ cache (and
// .branches/ etc.) inside supabase/ that must never ship in the tarball.
cpSync(source, dest, {
  recursive: true,
  filter: (src) => !path.basename(src).startsWith("."),
});

console.log(`copy-templates: copied ${source} -> ${dest}`);
