// supabase-tests/accounts.sql checks merge_profiles' FK coverage over the SDK's own tables only
// (a host's tables are the host's to merge). Its `sdk_tables` list must name every table the
// migrations create, or a new SDK table referencing profiles would escape the check.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function sqlFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? sqlFiles(path.join(dir, e.name))
        : e.name.endsWith(".sql")
          ? [path.join(dir, e.name)]
          : [],
    );
}

describe("accounts.sql sdk_tables", () => {
  it("lists every table the migrations create", () => {
    const created = new Set<string>();
    for (const f of sqlFiles(path.join(ROOT, "supabase", "migrations"))) {
      for (const m of fs
        .readFileSync(f, "utf8")
        .matchAll(/create table (?:if not exists )?public\.(\w+)/gi)) {
        created.add(m[1]);
      }
    }
    const test = fs.readFileSync(path.join(ROOT, "supabase-tests", "accounts.sql"), "utf8");
    const list = test.match(/sdk_tables text\[\] := array\[([^\]]*)\]/)?.[1] ?? "";
    const listed = new Set([...list.matchAll(/'(\w+)'/g)].map((m) => m[1]));
    expect(created.size).toBeGreaterThan(0);
    expect([...created].filter((t) => !listed.has(t))).toEqual([]);
  });
});
