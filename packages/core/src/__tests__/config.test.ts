import { describe, expect, it, vi } from "vitest";
import {
  type CommunityConfig,
  CommunityDisabledError,
  DEFAULT_NAME,
  isEventTopic,
  resolveConfig,
  topicLive,
} from "../config";

const base = {
  supabase: null,
  appName: "Test App",
  topics: [{ id: "general" }, { id: "news", adminOnly: true }],
  modules: { polls: false, push: false, inbox: false, reaction: false as const },
};

it("requireClient throws CommunityDisabledError and warns exactly once when supabase is null", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const resolved = resolveConfig({ ...base });
  expect(() => resolved.requireClient()).toThrow(CommunityDisabledError);
  expect(() => resolved.requireClient()).toThrow(CommunityDisabledError);
  expect(warn).toHaveBeenCalledTimes(1);
});

it("composeTopics offers adminOnly topics to admins only", () => {
  const r = resolveConfig({ ...base });
  expect(r.composeTopics(false).map((t) => t.id)).toEqual(["general"]);
  expect(r.composeTopics(true).map((t) => t.id)).toEqual(["general", "news"]);
});

it("isAdminTopic", () => {
  const r = resolveConfig({ ...base });
  expect(r.isAdminTopic("news")).toBe(true);
  expect(r.isAdminTopic("general")).toBe(false);
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

describe("event topics", () => {
  const cfg = resolveConfig({
    ...base,
    topics: [
      { id: "general" },
      { id: "news", adminOnly: true },
      { id: "nnn", from: "2026-11-01", until: "2026-12-01" },
    ],
  });
  const ids = (topics: { id: string }[]) => topics.map((t) => t.id);

  it("lists a live event topic first, and nowhere outside its window", () => {
    expect(ids(cfg.feedTopics(new Date(2026, 10, 4)))).toEqual(["nnn", "general", "news"]);
    expect(ids(cfg.feedTopics(new Date(2026, 9, 31, 23, 59)))).toEqual(["general", "news"]);
    expect(ids(cfg.feedTopics(new Date(2026, 11, 1)))).toEqual(["general", "news"]);
  });

  it("offers a live event topic in the composer, first", () => {
    expect(ids(cfg.composeTopics(false, new Date(2026, 10, 4)))).toEqual(["nnn", "general"]);
    expect(ids(cfg.composeTopics(true, new Date(2026, 11, 2)))).toEqual(["general", "news"]);
  });

  it("reads a date as local midnight and a timestamp as given, either bound optional", () => {
    expect(isEventTopic({ id: "general" })).toBe(false);
    expect(topicLive({ id: "x", from: "2026-11-01" }, new Date(2026, 10, 1))).toBe(true);
    expect(
      topicLive({ id: "x", from: "2026-11-01T10:00:00Z" }, new Date("2026-11-01T09:59:59Z")),
    ).toBe(false);
    expect(
      topicLive(
        { id: "x", until: new Date("2026-11-01T10:00:00Z") },
        new Date("2026-11-01T09:59:59Z"),
      ),
    ).toBe(true);
    expect(topicLive({ id: "x", until: "2026-11-01" }, new Date(2026, 10, 1))).toBe(false);
  });
});
