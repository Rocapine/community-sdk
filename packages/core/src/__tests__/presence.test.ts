import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveConfig, presenceSettings, type CommunityModules } from "../config";
import { resetIdentity } from "../identity";
import {
  createOnlineBatcher,
  fetchMyPresenceVisible,
  fetchOnlineCount,
  fetchOnlineIds,
  setPresenceVisible,
  startPresenceHeartbeat,
  touchPresence,
  type AppStateLike,
} from "../presence";

function fakeClient(opts: { session?: object | null; rpcData?: unknown; rpcError?: unknown } = {}) {
  const session = opts.session === undefined ? { user: { id: "uid1" } } : opts.session;
  const maybeSingle = vi.fn(async () => ({ data: { visible: false }, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      signInAnonymously: vi.fn(),
    },
    rpc: vi.fn(async () => ({ data: opts.rpcData ?? null, error: opts.rpcError ?? null })),
    from: vi.fn(() => ({ select })),
    eq,
    select,
    maybeSingle,
  };
}

function cfgWith(
  presence: CommunityModules["presence"],
  client: ReturnType<typeof fakeClient> | null = fakeClient(),
) {
  return resolveConfig({
    supabase: client as unknown as SupabaseClient | null,
    appName: "Test",
    topics: [{ id: "general" }],
    modules: { polls: false, push: false, inbox: false, reaction: false, presence },
  });
}

function fakeAppState(initial: string) {
  let listener: (s: string) => void = () => {};
  const remove = vi.fn();
  const app: AppStateLike & { emit(s: string): void; remove: typeof remove } = {
    currentState: initial,
    addEventListener: (_t, l) => {
      listener = l;
      return { remove };
    },
    emit: (s) => listener(s),
    remove,
  };
  return app;
}

beforeEach(() => {
  resetIdentity();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("presenceSettings", () => {
  it("null when off, defaults when {}", () => {
    expect(presenceSettings(cfgWith(undefined))).toBeNull();
    expect(presenceSettings(cfgWith(false))).toBeNull();
    expect(presenceSettings(cfgWith({}))).toEqual({
      graceMinutes: 5,
      minCount: 0,
      collapseAfterMs: 3000,
    });
    expect(presenceSettings(cfgWith({ collapseAfterMs: false }))!.collapseAfterMs).toBe(false);
  });
});

describe("touchPresence", () => {
  it("never signs in when there is no session", async () => {
    const client = fakeClient({ session: null });
    await touchPresence(cfgWith({}, client));
    expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("calls touch_presence with a session, and never rejects", async () => {
    const client = fakeClient();
    await touchPresence(cfgWith({}, client));
    expect(client.rpc).toHaveBeenCalledWith("touch_presence");
    client.rpc.mockRejectedValueOnce(new Error("x"));
    await expect(touchPresence(cfgWith({}, client))).resolves.toBeUndefined();
  });
  it("no-ops when the module is off or there is no client", async () => {
    const client = fakeClient();
    await touchPresence(cfgWith(undefined, client));
    expect(client.rpc).not.toHaveBeenCalled();
    await expect(touchPresence(cfgWith({}, null))).resolves.toBeUndefined();
  });
});

describe("heartbeat", () => {
  it("one beat per transition, never two intervals", async () => {
    const client = fakeClient();
    const beats = () =>
      client.rpc.mock.calls.filter((c) => (c as unknown[])[0] === "touch_presence").length;
    const app = fakeAppState("active");
    const stop = startPresenceHeartbeat(cfgWith({}, client), app, 60_000);
    await vi.advanceTimersByTimeAsync(0);
    app.emit("active");
    app.emit("inactive");
    app.emit("active");
    app.emit("active");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(beats()).toBe(4); // start, → inactive, → active, +1 interval tick
    stop();
    expect(app.remove).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(beats()).toBe(4);
  });
  it("starts in background without beating, then beats on activation", async () => {
    const client = fakeClient();
    const app = fakeAppState("background");
    startPresenceHeartbeat(cfgWith({}, client), app, 60_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.rpc).not.toHaveBeenCalled();
    app.emit("active");
    await vi.advanceTimersByTimeAsync(0);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
  it("returns a no-op stop when the module is off", () => {
    const app = fakeAppState("active");
    const addSpy = vi.spyOn(app, "addEventListener");
    startPresenceHeartbeat(cfgWith(undefined), app)();
    expect(addSpy).not.toHaveBeenCalled();
  });
});

describe("batcher", () => {
  it("dedups within the window and chunks by 200", async () => {
    const fetch = vi.fn(async (ids: string[]) => ids.filter((id) => id.endsWith("0")));
    const load = createOnlineBatcher(fetch, 30, 200);
    const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const p = Promise.all([...ids, "u10", "u10"].map(load));
    await vi.advanceTimersByTimeAsync(30);
    const results = await p;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((c) => c[0].length)).toEqual([200, 50]);
    expect(results[10]).toBe(true);
    expect(results[11]).toBe(false);
    expect(results[250]).toBe(true);
  });
  it("resolves false when the fetch fails", async () => {
    const load = createOnlineBatcher(async () => {
      throw new Error("x");
    });
    const p = load("u1");
    await vi.advanceTimersByTimeAsync(30);
    await expect(p).resolves.toBe(false);
  });
});

describe("fetchers", () => {
  it("fetchOnlineIds passes the grace; [] skips the rpc", async () => {
    const client = fakeClient({ rpcData: ["a"] });
    await expect(fetchOnlineIds(cfgWith({ graceMinutes: 7 }, client), ["a"])).resolves.toEqual([
      "a",
    ]);
    expect(client.rpc).toHaveBeenCalledWith("online_member_ids", {
      p_ids: ["a"],
      p_grace_minutes: 7,
    });
    client.rpc.mockClear();
    await expect(fetchOnlineIds(cfgWith({}, client), [])).resolves.toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("fetchOnlineCount passes the grace and throws on error", async () => {
    const client = fakeClient({ rpcData: 12 });
    await expect(fetchOnlineCount(cfgWith({}, client))).resolves.toBe(12);
    expect(client.rpc).toHaveBeenCalledWith("online_member_count", { p_grace_minutes: 5 });
    const bad = fakeClient({ rpcError: new Error("boom") });
    await expect(fetchOnlineCount(cfgWith({}, bad))).rejects.toThrow("boom");
  });
  it("fetchMyPresenceVisible reads own row; missing row ⇒ true", async () => {
    const client = fakeClient();
    await expect(fetchMyPresenceVisible(cfgWith({}, client))).resolves.toBe(false);
    expect(client.from).toHaveBeenCalledWith("member_presence");
    expect(client.eq).toHaveBeenCalledWith("user_id", "uid1");
    client.maybeSingle.mockResolvedValueOnce({ data: null, error: null } as never);
    await expect(fetchMyPresenceVisible(cfgWith({}, client))).resolves.toBe(true);
  });
  it("setPresenceVisible calls the rpc and throws on error", async () => {
    const client = fakeClient();
    await setPresenceVisible(cfgWith({}, client), false);
    expect(client.rpc).toHaveBeenCalledWith("set_presence_visible", { p_visible: false });
    const bad = fakeClient({ rpcError: new Error("nope") });
    await expect(setPresenceVisible(cfgWith({}, bad), true)).rejects.toThrow("nope");
  });
});
