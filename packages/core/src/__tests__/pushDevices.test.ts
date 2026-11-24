import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveConfig, type CommunityHostAdapters } from "../config";
import { resetIdentity } from "../identity";
import { registerPushDevice, unregisterPushDevice } from "../push-devices";

function fakeClient() {
  const calls: { op: string; table: string; args: unknown[] }[] = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "uid1" } } }, error: null }),
    },
    from: (table: string) => ({
      upsert: async (...args: unknown[]) => {
        calls.push({ op: "upsert", table, args });
        return { error: null };
      },
      delete: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: async (c2: string, v2: unknown) => {
            calls.push({ op: "delete", table, args: [c1, v1, c2, v2] });
            return { error: null };
          },
        }),
      }),
    }),
    rpc: async () => ({ error: null }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

const cfgWith = (client: SupabaseClient, host: CommunityHostAdapters) =>
  resolveConfig({
    supabase: client,
    appName: "Test App",
    topics: [{ id: "general" }],
    modules: { polls: false, push: true, inbox: false, reaction: false as const },
    host,
  });

describe("push devices", () => {
  beforeEach(() => {
    resetIdentity();
  });

  it("registerPushDevice upserts this device's row on the member's profile", async () => {
    const { client, calls } = fakeClient();
    await registerPushDevice(cfgWith(client, { getInstallId: () => "install-1" }), "tok");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      op: "upsert",
      table: "push_devices",
      args: [{ user_id: "uid1", device_id: "install-1", expo_push_token: "tok" }],
    });
  });

  it("registerPushDevice is a no-op without an install id", async () => {
    const { client, calls } = fakeClient();
    await registerPushDevice(cfgWith(client, {}), "tok");
    expect(calls).toHaveLength(0);
  });

  it("unregisterPushDevice deletes this device's row only", async () => {
    const { client, calls } = fakeClient();
    await unregisterPushDevice(cfgWith(client, { getInstallId: () => "install-1" }));
    expect(calls).toEqual([
      {
        op: "delete",
        table: "push_devices",
        args: ["user_id", "uid1", "device_id", "install-1"],
      },
    ]);
  });

  it("unregisterPushDevice is a no-op without an install id", async () => {
    const { client, calls } = fakeClient();
    await unregisterPushDevice(cfgWith(client, { getInstallId: () => null }));
    expect(calls).toHaveLength(0);
  });
});
