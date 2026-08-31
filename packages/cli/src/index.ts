#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { runInit } from "./commands/init";
import { runUpgrade } from "./commands/upgrade";
import { runAdopt } from "./commands/adopt";

function readOwnVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

function parseModulesFlag(modules: string | undefined): string[] | undefined {
  return modules
    ? modules
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
    : undefined;
}

const program = new Command();

program
  .name("community")
  .description(
    "Install and manage the Rocapine Community SDK backend (Supabase migrations + Edge Functions)",
  )
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
  .action(
    async (opts: { modules?: string; projectUrl?: string; anonKey?: string; dir?: string }) => {
      try {
        await runInit({
          modules: parseModulesFlag(opts.modules),
          projectUrl: opts.projectUrl,
          anonKey: opts.anonKey,
          dir: opts.dir,
        });
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    },
  );

program
  .command("upgrade")
  .description(
    "Copy any new migrations/Edge Functions shipped since this repo's community-sdk.json was last written, and overwrite changed function code (with a warning)",
  )
  .option(
    "--project-url <url>",
    "Supabase project URL, e.g. https://<ref>.supabase.co (only needed if a new migration carries a placeholder)",
  )
  .option(
    "--anon-key <key>",
    "Supabase anon key (only needed if a new migration carries a placeholder)",
  )
  .option("--dir <dir>", "target Supabase directory, relative to the current directory", "supabase")
  .action(async (opts: { projectUrl?: string; anonKey?: string; dir?: string }) => {
    try {
      await runUpgrade({
        projectUrl: opts.projectUrl,
        anonKey: opts.anonKey,
        dir: opts.dir,
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command("adopt")
  .description(
    "Register an already-live community backend (e.g. Eve, Nightward) with community-sdk.json, without copying any files",
  )
  .requiredOption(
    "--schema-version <n>",
    "the community-sdk schema version this app's live backend corresponds to",
  )
  .requiredOption(
    "--modules <modules>",
    "comma-separated module list (core,push,polls,reaction,inbox) — core is always implied",
  )
  .option(
    "--dir <dir>",
    "Supabase directory this app would use, relative to the current directory",
    "supabase",
  )
  .action(async (opts: { schemaVersion: string; modules: string; dir?: string }) => {
    try {
      const schemaVersion = Number(opts.schemaVersion);
      await runAdopt({
        schemaVersion,
        modules: parseModulesFlag(opts.modules) ?? [],
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
