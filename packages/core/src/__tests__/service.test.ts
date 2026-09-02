import { afterEach, expect, it, vi } from "vitest";
import { buildFeedSelect } from "../service";

// buildFeedSelect is the pure, mockable piece of the feed.extraPostColumns
// extension point (see config.ts) — the network-hitting fetch* functions just
// pass `cfg.feed.extraPostColumns` through to it, so these tests cover the
// select-string behavior without a Supabase client.

const BASE_SELECT_PREFIX = "id, author_id, topic, content, status";

afterEach(() => {
  vi.restoreAllMocks();
});

it("returns the base select unchanged when extraPostColumns is absent or empty", () => {
  const base = buildFeedSelect(undefined);
  expect(base.startsWith(BASE_SELECT_PREFIX)).toBe(true);
  expect(buildFeedSelect([])).toBe(base);
});

it("appends valid extraPostColumns to the select string", () => {
  const select = buildFeedSelect(["seed_likes", "featured_rank"]);
  expect(select).toBe(`${buildFeedSelect(undefined)}, seed_likes, featured_rank`);
});

it("drops invalid column names and warns, keeping only the valid ones", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const select = buildFeedSelect(["seed_likes", "profiles(role)", "a b", "DROP TABLE posts;--"]);
  expect(select).toBe(`${buildFeedSelect(undefined)}, seed_likes`);
  expect(warn).toHaveBeenCalledTimes(3);
});

it("falls back to the base select when every entry is invalid", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const select = buildFeedSelect(["profiles(role)", "*"]);
  expect(select).toBe(buildFeedSelect(undefined));
  expect(warn).toHaveBeenCalledTimes(2);
});
