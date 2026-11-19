import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveConfig, type CommunityConfig } from "../config";
import { ensureIdentity, resetIdentity, syncProfileFromHost } from "../identity";

type Capture = { update?: Record<string, unknown> };

function makeClient(capture: Capture): SupabaseClient {
  return {
    auth: {
      // A pre-existing session short-circuits bootstrap() before it ever
      // touches the profiles table, keeping this stub minimal.
      getSession: async () => ({ data: { session: { user: { id: "uid1" } } } }),
    },
    from: (_table: string) => ({
      update: (payload: Record<string, unknown>) => {
        capture.update = payload;
        return { eq: async () => ({ error: null }) };
      },
    }),
  } as unknown as SupabaseClient;
}

const baseConfig = (supabase: SupabaseClient, push: boolean): CommunityConfig => ({
  supabase,
  appName: "Test App",
  topics: [{ id: "general" }],
  modules: { polls: false, push, inbox: false, reaction: false as const },
  host: {
    getDisplayName: () => null, // keep username out of the payload
    getLocale: () => "fr",
    getAnalyticsIds: () => ({}),
  },
});

describe("syncProfileFromHost — locale gated on the push module", () => {
  beforeEach(() => {
    resetIdentity();
  });

  it("omits locale from the update payload when modules.push is false", async () => {
    const capture: Capture = {};
    const client = makeClient(capture);
    await syncProfileFromHost(resolveConfig(baseConfig(client, false)));

    expect(capture.update).toBeDefined();
    expect(capture.update).not.toHaveProperty("locale");
  });

  it("includes locale in the update payload when modules.push is true", async () => {
    const capture: Capture = {};
    const client = makeClient(capture);
    await syncProfileFromHost(resolveConfig(baseConfig(client, true)));

    expect(capture.update).toBeDefined();
    expect(capture.update).toMatchObject({ locale: "fr" });
  });

  it("does not advance the locale memo when the update errors (no false-positive dedupe)", async () => {
    const capture: Capture = {};
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: "uid1" } } } }) },
      from: (_table: string) => ({
        update: (payload: Record<string, unknown>) => {
          capture.update = payload;
          return { eq: async () => ({ error: new Error("network down") }) };
        },
      }),
    } as unknown as SupabaseClient;

    const cfg = resolveConfig(baseConfig(client, true));
    await syncProfileFromHost(cfg); // fails — memo must NOT advance
    await syncProfileFromHost(cfg); // retries — locale must be sent again

    expect(capture.update).toMatchObject({ locale: "fr" });
  });
});

describe("ensureIdentity — default name", () => {
  beforeEach(() => {
    resetIdentity();
  });

  it("asks the backend for a default name in the host's language, once per launch", async () => {
    const calls: { fn: string; args: unknown }[] = [];
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: "uid1" } } } }) },
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return { error: null };
      },
    } as unknown as SupabaseClient;
    const cfg = resolveConfig({
      ...baseConfig(client, false),
      defaultName: { label: (l) => (l === "fr" ? "Frère" : "Brother"), handle: "brother" },
    });

    expect(await ensureIdentity(cfg)).toBe("uid1");
    await ensureIdentity(cfg);
    expect(calls).toEqual([
      { fn: "assign_default_profile", args: { p_label: "Frère", p_handle: "brother" } },
    ]);
  });

  it("still resolves the identity when the backend has no such RPC", async () => {
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: "uid1" } } } }) },
      rpc: async () => {
        throw new Error("not found");
      },
    } as unknown as SupabaseClient;
    expect(await ensureIdentity(resolveConfig(baseConfig(client, false)))).toBe("uid1");
  });
});

describe("ensureIdentity — never replaces a session it could not read", () => {
  beforeEach(() => {
    resetIdentity();
  });

  function clientWith(getSession: () => Promise<unknown>) {
    const signIns: number[] = [];
    const client = {
      auth: {
        getSession,
        signInAnonymously: async () => {
          signIns.push(1);
          return { data: { user: { id: "new-uid" } }, error: null };
        },
      },
      from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
      rpc: async () => ({ error: null }),
    } as unknown as SupabaseClient;
    return { client, signIns };
  }

  it("does not sign in anonymously when getSession reports an error (refresh failed offline)", async () => {
    // auth-js returns { session: null, error } when the stored session's refresh fails
    // with a network error: the session is still in storage, signing in would overwrite it.
    const { client, signIns } = clientWith(async () => ({
      data: { session: null },
      error: Object.assign(new Error("Network request failed"), {
        name: "AuthRetryableFetchError",
      }),
    }));
    expect(await ensureIdentity(resolveConfig(baseConfig(client, false)))).toBeNull();
    expect(signIns).toHaveLength(0);
  });

  it("signs in anonymously when there is no session and no error", async () => {
    const { client, signIns } = clientWith(async () => ({ data: { session: null }, error: null }));
    expect(await ensureIdentity(resolveConfig(baseConfig(client, false)))).toBe("new-uid");
    expect(signIns).toHaveLength(1);
  });
});
