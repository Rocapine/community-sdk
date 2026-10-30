import { describe, expect, it, vi } from "vitest";
import {
  type CommunityConfig,
  CommunityDisabledError,
  DEFAULT_NAME,
  resolveConfig,
} from "../config";

const base = {
  supabase: null,
  appName: "Test App",
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
  } as unknown as CommunityConfig;

  it("defaults to the SDK's neutral name", () => {
    const cfg = resolveConfig(base);
    expect(cfg.defaultName).toEqual(DEFAULT_NAME);
    expect(cfg.authorFallback()).toBe("User");
  });

  it("returns a plain string label as-is", () => {
    const cfg = resolveConfig({ ...base, defaultName: { label: "Brother", handle: "brother" } });
    expect(cfg.authorFallback()).toBe("Brother");
  });

  it("resolves a function label against the host locale", () => {
    const cfg = resolveConfig({
      ...base,
      defaultName: {
        label: (locale: string) => (locale.startsWith("fr") ? "Frère" : "Brother"),
        handle: "brother",
      },
      host: { getLocale: () => "fr-vous" },
    });
    expect(cfg.authorFallback()).toBe("Frère");
  });
});

it("postMaxLength defaults to 500 and never exceeds the database's 2000", () => {
  expect(resolveConfig({ ...base }).postMaxLength).toBe(500);
  expect(resolveConfig({ ...base, postMaxLength: 800 }).postMaxLength).toBe(800);
  expect(resolveConfig({ ...base, postMaxLength: 5000 }).postMaxLength).toBe(2000);
});
