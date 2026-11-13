import {
  environmentManager,
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { COMMUNITY_EVENTS } from "../events";
import {
  isOnlineQueryOptions,
  onlineCountQueryOptions,
  presenceVisibilityMutationOptions,
} from "../presence-hooks";
import * as presence from "../presence";

vi.mock("../presence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../presence")>()),
  setPresenceVisible: vi.fn(),
}));

const mods = { polls: false, push: false, inbox: false, reaction: false, badges: false };
const base = { supabase: {} as never, appName: "t", topics: [] };
const on = resolveConfig({ ...base, modules: { ...mods, presence: {} } });
const off = resolveConfig({ ...base, modules: { ...mods } });
const cfgWith = (onEvent: (n: string, p?: unknown) => void) =>
  resolveConfig({ ...base, modules: { ...mods, presence: {} }, host: { onEvent } });

const qc = new QueryClient();

it("every presence query is disabled when the module is off", () => {
  expect(onlineCountQueryOptions(off).enabled).toBe(false);
  expect(isOnlineQueryOptions(off, "u1").enabled).toBe(false);
});

it("queries are enabled when the module is on, isOnline only with a user id", () => {
  expect(onlineCountQueryOptions(on).enabled).toBe(true);
  expect(isOnlineQueryOptions(on, "u1").enabled).toBe(true);
  expect(isOnlineQueryOptions(on, null).enabled).toBe(false);
});

it("a failed visibility write rejects and emits nothing", async () => {
  vi.mocked(presence.setPresenceVisible).mockRejectedValue(new Error("x"));
  const onEvent = vi.fn();
  const c = cfgWith(onEvent);
  await expect(
    new MutationObserver(qc, presenceVisibilityMutationOptions(c, qc)).mutate(false),
  ).rejects.toThrow("x");
  expect(onEvent).not.toHaveBeenCalled();
});

it("a successful write emits community_presence_visibility_changed", async () => {
  vi.mocked(presence.setPresenceVisible).mockResolvedValue();
  const onEvent = vi.fn();
  const c = cfgWith(onEvent);
  await new MutationObserver(qc, presenceVisibilityMutationOptions(c, qc)).mutate(false);
  expect(onEvent).toHaveBeenCalledWith("community_presence_visibility_changed", { visible: false });
  expect(COMMUNITY_EVENTS.presenceVisibilityChanged).toBe("community_presence_visibility_changed");
});

const wasServer = environmentManager.isServer();
afterEach(() => {
  vi.useRealTimers();
  environmentManager.setIsServer(() => wasServer);
});

it("observers mounted apart poll together: one online_member_ids batch per minute", async () => {
  environmentManager.setIsServer(() => false); // TanStack schedules no refetchInterval on a server
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T10:00:10.000Z"));
  const rpc = vi.fn(async (_fn: string, args: { p_ids: string[] }) => ({
    data: args.p_ids,
    error: null,
  }));
  const c = resolveConfig({
    ...base,
    supabase: { rpc } as never,
    modules: { ...mods, presence: {} },
  });
  const client = new QueryClient();
  const a = new QueryObserver(client, isOnlineQueryOptions(c, "a")).subscribe(() => {});
  await vi.advanceTimersByTimeAsync(100);
  const b = new QueryObserver(client, isOnlineQueryOptions(c, "b")).subscribe(() => {});
  await vi.advanceTimersByTimeAsync(100);
  expect(rpc).toHaveBeenCalledTimes(2); // one batch per mount group

  rpc.mockClear();
  await vi.advanceTimersByTimeAsync(49_800 + 50); // past 10:01:00 and the 30 ms batch window
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0][1].p_ids.sort()).toEqual(["a", "b"]);
  a();
  b();
  client.clear();
});
