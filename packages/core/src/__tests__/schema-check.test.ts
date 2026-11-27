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

describe("messaging settings check", () => {
  const withGroups = (rpc: unknown, groups: object | false = {}) =>
    resolveConfig({
      ...baseConfig,
      modules: { ...baseConfig.modules, groups },
      supabase: {
        from: stubClient({ data: null, error: new Error("x") }).from,
        rpc,
      } as unknown as SupabaseClient,
    });
  const backend = {
    moderation: "post",
    translation: "onDemand",
    pushPreview: "full",
    onAccountDelete: "keep",
    maxLength: 2000,
    ratePerMinute: 20,
    groupsPreview: "readOnly",
    groupsRequireAccount: false,
    groupsCreateRequiresAccount: true,
    maxCreatedPerMember: 3,
    maxJoinedPerMember: 50,
    maxMembers: null,
    nameMaxLength: 60,
    descriptionMaxLength: 500,
  };

  it("is silent when the defaults match the backend", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await checkSchemaVersionUnguarded(withGroups(async () => ({ data: backend, error: null })));
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns maxLength when the backend says 2000 and the client 4000", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = resolveConfig({
      ...baseConfig,
      messaging: { maxLength: 4000 },
      modules: { ...baseConfig.modules, groups: {} },
      supabase: {
        from: stubClient({ data: null, error: null }).from,
        rpc: async () => ({ data: backend, error: null }),
      } as unknown as SupabaseClient,
    });
    await checkSchemaVersionUnguarded(cfg);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("maxLength");
  });

  it("warns once that the migration is missing when the function is absent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await checkSchemaVersionUnguarded(
      withGroups(async () => ({ data: null, error: { message: "function not found" } })),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("migration");
  });

  it("does not call the backend when groups is off", async () => {
    const rpc = vi.fn();
    await checkSchemaVersionUnguarded(withGroups(rpc, false));
    expect(rpc).not.toHaveBeenCalled();
  });
});
