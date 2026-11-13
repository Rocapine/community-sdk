import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
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
