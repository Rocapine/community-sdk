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
  presenceValue,
  PRESENCE_KEY,
  presenceVisibilityMutationOptions,
  presenceVisibleQueryOptions,
  untilNextPoll,
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

it("the visibility query is disabled when the module is off", () => {
  expect(presenceVisibleQueryOptions(off).enabled).toBe(false);
  expect(presenceVisibleQueryOptions(on).enabled).toBe(true);
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

it("a successful visibility write invalidates the whole presence cache", async () => {
  vi.mocked(presence.setPresenceVisible).mockResolvedValue();
  const client = new QueryClient();
  client.setQueryData([...PRESENCE_KEY, "count"], 3);
  client.setQueryData([...PRESENCE_KEY, "online", "u1"], true);
  await new MutationObserver(
    client,
    presenceVisibilityMutationOptions(cfgWith(vi.fn()), client),
  ).mutate(false);
  expect(client.getQueryState([...PRESENCE_KEY, "count"])!.isInvalidated).toBe(true);
  expect(client.getQueryState([...PRESENCE_KEY, "online", "u1"])!.isInvalidated).toBe(true);
  client.clear();
});

it("one lookup batcher per config object, another for a different config", async () => {
  vi.useFakeTimers();
  const mk = () => {
    const rpc = vi.fn(async (_fn: string, args: { p_ids: string[] }) => ({
      data: args.p_ids,
      error: null,
    }));
    return {
      rpc,
      cfg: resolveConfig({
        ...base,
        supabase: { rpc } as never,
        modules: { ...mods, presence: {} },
      }),
    };
  };
  const one = mk();
  const two = mk();
  const lookup = (c: typeof one, id: string) => isOnlineQueryOptions(c.cfg, id).queryFn();
  const results = Promise.all([lookup(one, "a"), lookup(one, "b"), lookup(two, "c")]);
  await vi.advanceTimersByTimeAsync(30);
  await results;
  expect(one.rpc).toHaveBeenCalledTimes(1);
  expect(one.rpc.mock.calls[0][1].p_ids).toEqual(["a", "b"]);
  expect(two.rpc).toHaveBeenCalledTimes(1);
  expect(two.rpc.mock.calls[0][1].p_ids).toEqual(["c"]);
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

it("untilNextPoll waits for the next minute, and skips a boundary under a second away", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T10:00:10.000Z"));
  expect(untilNextPoll()).toBe(50_000);
  vi.setSystemTime(new Date("2026-11-13T10:00:59.001Z"));
  expect(untilNextPoll()).toBe(60_999); // 999 ms left: the next boundary, not a near-0 poll
  vi.setSystemTime(new Date("2026-11-13T10:00:59.000Z"));
  expect(untilNextPoll()).toBe(1_000);
});

it("a failed lookup keeps the previous answer (no dot is erased)", async () => {
  environmentManager.setIsServer(() => false);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T10:00:10.000Z"));
  let fail = false;
  const rpc = vi.fn(async (_fn: string, args: { p_ids: string[] }) =>
    fail ? { data: null, error: new Error("net") } : { data: args.p_ids, error: null },
  );
  const c = resolveConfig({
    ...base,
    supabase: { rpc } as never,
    modules: { ...mods, presence: {} },
  });
  const client = new QueryClient();
  const observer = new QueryObserver(client, isOnlineQueryOptions(c, "a"));
  const stop = observer.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(100);
  expect(observer.getCurrentResult().data).toBe(true);

  fail = true;
  await vi.advanceTimersByTimeAsync(60_000 + 10_000); // the poll, its retry, and past it
  expect(rpc.mock.calls.length).toBeGreaterThan(1);
  expect(observer.getCurrentResult().isError).toBe(true);
  expect(observer.getCurrentResult().data).toBe(true);
  stop();
  client.clear();
});

it("module off returns the off value even when the cache holds data", () => {
  const cache = new QueryClient();
  cache.setQueryData(isOnlineQueryOptions(on, "u1").queryKey, true);
  const cached = cache.getQueryData<boolean>(isOnlineQueryOptions(off, "u1").queryKey);
  expect(cached).toBe(true);
  expect(presenceValue(isOnlineQueryOptions(off, "u1").enabled, cached, false)).toBe(false);
  expect(presenceValue(onlineCountQueryOptions(off).enabled, 7, null)).toBeNull();
  expect(presenceValue(isOnlineQueryOptions(on, "u1").enabled, cached, false)).toBe(true);
  expect(presenceValue(isOnlineQueryOptions(on, null).enabled, cached, false)).toBe(false);
});
