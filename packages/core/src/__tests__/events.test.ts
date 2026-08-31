import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { COMMUNITY_EVENTS, emitEvent } from "../events";

const base = {
  supabase: null,
  appName: "Test App",
  anonymousAuthorFallback: "Someone",
  topics: [{ id: "general" }],
  modules: { polls: false, push: false, inbox: false, reaction: false as const },
};

it("forwards to host.onEvent with name and props", () => {
  const onEvent = vi.fn();
  const cfg = resolveConfig({ ...base, host: { onEvent } });
  emitEvent(cfg, COMMUNITY_EVENTS.opened, { source: "toolbox" });
  expect(onEvent).toHaveBeenCalledWith("community_opened", { source: "toolbox" });
});

it("swallows a throwing adapter", () => {
  const onEvent = vi.fn(() => {
    throw new Error("boom");
  });
  const cfg = resolveConfig({ ...base, host: { onEvent } });
  expect(() => emitEvent(cfg, COMMUNITY_EVENTS.postLiked)).not.toThrow();
});

it("is a no-op without a host adapter (default onEvent)", () => {
  const cfg = resolveConfig({ ...base });
  expect(() => emitEvent(cfg, COMMUNITY_EVENTS.rulesAccepted)).not.toThrow();
});
