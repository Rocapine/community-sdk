import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import {
  checkSchemaVersion,
  checkSchemaVersionUnguarded,
  REQUIRED_SCHEMA_VERSION,
} from "../schema-check";

const baseConfig = {
  appName: "Test App",
  anonymousAuthorFallback: "Someone",
  topics: [],
  modules: { polls: false, push: false, inbox: false, reaction: false as const },
};

/** Minimal stub matching the one call site: `.from(...).select(...).maybeSingle()`. */
function stubClient(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        maybeSingle: async () => result,
      }),
    }),
  } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

describe("checkSchemaVersionUnguarded (read path, __DEV__ gate bypassed)", () => {
  it("warns once when schema_version mismatches REQUIRED_SCHEMA_VERSION", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveConfig({
      ...baseConfig,
      supabase: stubClient({ data: { schema_version: REQUIRED_SCHEMA_VERSION + 1 }, error: null }),
    });

    await checkSchemaVersionUnguarded(cfg);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("schema_version");
  });

  it("stays silent when schema_version matches", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveConfig({
      ...baseConfig,
      supabase: stubClient({ data: { schema_version: REQUIRED_SCHEMA_VERSION }, error: null }),
    });

    await checkSchemaVersionUnguarded(cfg);

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent on a query error (e.g. community_meta not migrated yet)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveConfig({
      ...baseConfig,
      supabase: stubClient({ data: null, error: new Error("relation does not exist") }),
    });

    await expect(checkSchemaVersionUnguarded(cfg)).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent in degraded mode (no supabase client configured)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveConfig({ ...baseConfig, supabase: null });

    await expect(checkSchemaVersionUnguarded(cfg)).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("checkSchemaVersion (__DEV__ gate)", () => {
  it("does nothing when __DEV__ is undefined (this test environment)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveConfig({
      ...baseConfig,
      supabase: stubClient({ data: { schema_version: REQUIRED_SCHEMA_VERSION + 1 }, error: null }),
    });

    await checkSchemaVersion(cfg);

    expect(warn).not.toHaveBeenCalled();
  });

  it("does nothing when __DEV__ is false (production)", async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveConfig({
      ...baseConfig,
      supabase: stubClient({ data: { schema_version: REQUIRED_SCHEMA_VERSION + 1 }, error: null }),
    });

    await checkSchemaVersion(cfg);

    expect(warn).not.toHaveBeenCalled();
  });

  it("runs the check when __DEV__ is true", async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveConfig({
      ...baseConfig,
      supabase: stubClient({ data: { schema_version: REQUIRED_SCHEMA_VERSION + 1 }, error: null }),
    });

    await checkSchemaVersion(cfg);

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
