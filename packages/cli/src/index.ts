#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { runInit } from "./commands/init";

function readOwnVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

const program = new Command();

program
  .name("community")
  .description("Install and manage the Rocapine Community SDK backend (Supabase migrations + Edge Functions)")
  .version(readOwnVersion());

program
  .command("init")
  .description(
    "Copy the community backend into a Supabase project: migrations, Edge Functions, and a community-sdk.json manifest",
  )
  .option(
    "--modules <modules>",
    "comma-separated module list (core,push,polls,reaction,inbox) — core is always implied; defaults to all modules",
  )
  .option("--project-url <url>", "Supabase project URL, e.g. https://<ref>.supabase.co")
  .option("--anon-key <key>", "Supabase anon key")
  .option("--dir <dir>", "target Supabase directory, relative to the current directory", "supabase")
  .action(async (opts: { modules?: string; projectUrl?: string; anonKey?: string; dir?: string }) => {
    try {
      const modules = opts.modules
        ? opts.modules
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean)
        : undefined;

      await runInit({
        modules,
        projectUrl: opts.projectUrl,
        anonKey: opts.anonKey,
        dir: opts.dir,
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
