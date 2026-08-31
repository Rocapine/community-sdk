import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveConfig, type CommunityConfig } from "../config";
import { resetIdentity, syncProfileFromHost } from "../identity";

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
  anonymousAuthorFallback: "Someone",
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
