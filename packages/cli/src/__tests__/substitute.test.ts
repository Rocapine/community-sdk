import { describe, expect, it } from "vitest";
import { substitutePlaceholders } from "../substitute";

describe("substitutePlaceholders", () => {
  const values = { projectUrl: "https://abcdefgh.supabase.co", anonKey: "anon-key-123" };

  it("replaces every occurrence of both placeholders", () => {
    const sql = [
      "url := '__SUPABASE_PROJECT_URL__/functions/v1/foo',",
      "'Authorization', 'Bearer __SUPABASE_ANON_KEY__'",
      "url := '__SUPABASE_PROJECT_URL__/functions/v1/bar',",
    ].join("\n");

    const result = substitutePlaceholders(sql, values);

    expect(result).not.toContain("__SUPABASE");
    expect(result.match(/https:\/\/abcdefgh\.supabase\.co/g)).toHaveLength(2);
    expect(result).toContain("Bearer anon-key-123");
  });

  it("passes through SQL with no placeholders unchanged", () => {
    const sql = "create table public.posts (id uuid primary key);";
    expect(substitutePlaceholders(sql, values)).toBe(sql);
  });

  it("throws if a __SUPABASE placeholder remains after substitution", () => {
    const sql = "url := '__SUPABASE_SERVICE_ROLE_KEY__';";
    expect(() => substitutePlaceholders(sql, values)).toThrow(/__SUPABASE/);
  });
});
