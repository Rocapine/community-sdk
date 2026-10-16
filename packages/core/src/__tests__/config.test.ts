import { describe, expect, it, vi } from "vitest";
import { type CommunityConfig, CommunityDisabledError, resolveConfig } from "../config";

const base = {
  supabase: null,
  appName: "Test App",
  anonymousAuthorFallback: "Someone",
  topics: [{ id: "general" }, { id: "news", officialOnly: true }],
  modules: { polls: false, push: false, inbox: false, reaction: false as const },
};

it("requireClient throws CommunityDisabledError and warns exactly once when supabase is null", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const resolved = resolveConfig({ ...base });
  expect(() => resolved.requireClient()).toThrow(CommunityDisabledError);
  expect(() => resolved.requireClient()).toThrow(CommunityDisabledError);
  expect(warn).toHaveBeenCalledTimes(1);
});

it("composeTopics excludes officialOnly topics", () => {
  expect(
    resolveConfig({ ...base })
      .composeTopics()
      .map((t) => t.id),
  ).toEqual(["general"]);
});

it("isOfficialTopic", () => {
  const r = resolveConfig({ ...base });
  expect(r.isOfficialTopic("news")).toBe(true);
  expect(r.isOfficialTopic("general")).toBe(false);
});

it("host adapters default to safe no-ops", async () => {
  const r = resolveConfig({ ...base });
  expect(r.host.getDisplayName()).toBeNull();
  expect(await r.host.rulesAcceptance.get()).toBe(false);
  r.host.onEvent("community_opened", {}); // must not throw
});

it("feed defaults to {} when omitted", () => {
  const r = resolveConfig({ ...base });
  expect(r.feed).toEqual({});
});

it("feed carries through the extension point when provided", () => {
  const transformPost = () => {
    throw new Error("not called by resolveConfig");
  };
  const r = resolveConfig({ ...base, feed: { extraPostColumns: ["seed_likes"], transformPost } });
  expect(r.feed.extraPostColumns).toEqual(["seed_likes"]);
  expect(r.feed.transformPost).toBe(transformPost);
});

describe("authorFallback", () => {
  const base = {
    supabase: null,
    appName: "App",
    topics: [],
    modules: {},
  } as unknown as Omit<CommunityConfig, "anonymousAuthorFallback">;

  it("returns a plain string fallback as-is", () => {
    const cfg = resolveConfig({ ...base, anonymousAuthorFallback: "A brother" });
    expect(cfg.authorFallback()).toBe("A brother");
  });

  it("resolves a function fallback against the host locale", () => {
    const cfg = resolveConfig({
      ...base,
      anonymousAuthorFallback: (locale: string) =>
        locale.startsWith("fr") ? "Un frère" : "A brother",
      host: { getLocale: () => "fr-vous" },
    });
    expect(cfg.authorFallback()).toBe("Un frère");
  });
});
