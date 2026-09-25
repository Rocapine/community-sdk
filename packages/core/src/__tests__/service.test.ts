import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { buildFeedSelect, threadSelect, withTranslationFilters } from "../service";

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

it("embeds poll_options only when the polls module is on", () => {
  expect(buildFeedSelect(undefined, false)).not.toContain("poll_options");
  expect(buildFeedSelect(undefined, true)).toContain("poll_options(id, idx, label)");
  expect(buildFeedSelect(["seed_likes"], true)).toBe(
    `${buildFeedSelect(undefined, true)}, seed_likes`,
  );
});

it("embeds translations (and nested poll label translations) only when asked", () => {
  const plain = buildFeedSelect(undefined, true, false);
  expect(plain).not.toContain("post_translations");
  const withT = buildFeedSelect(undefined, true, true);
  expect(withT).toContain("post_translations(locale, source_locale, content)");
  expect(withT).toContain("poll_options(id, idx, label, poll_option_translations(content))");
  const noPolls = buildFeedSelect(undefined, false, true);
  expect(noPolls).toContain("post_translations(");
  expect(noPolls).not.toContain("poll_option");
});

const base = {
  supabase: null,
  appName: "t",
  anonymousAuthorFallback: "Someone",
  topics: [],
  modules: { polls: false, push: false, inbox: false, reaction: false as const },
};
const locales = ["en", "es-ES", "es-419"];
const cfgFor = (opts: { translation: boolean; polls?: boolean; locale?: string }) =>
  resolveConfig({
    ...base,
    modules: {
      ...base.modules,
      polls: opts.polls ?? false,
      translation: opts.translation ? { locales } : false,
    },
    host: { getLocale: () => opts.locale ?? "es-419" },
  });

/** Chainable fake query builder that records every `.eq` call. */
function fakeQuery() {
  const eqs: [string, string][] = [];
  const q = {
    eq(column: string, value: string) {
      eqs.push([column, value]);
      return q;
    },
  };
  return { q, eqs };
}

describe("withTranslationFilters", () => {
  it("adds no filter when the module is off", () => {
    const { q, eqs } = fakeQuery();
    expect(withTranslationFilters(q, cfgFor({ translation: false, polls: true }))).toBe(q);
    expect(eqs).toEqual([]);
  });

  it("adds no filter when the reader locale does not resolve", () => {
    const { q, eqs } = fakeQuery();
    withTranslationFilters(q, cfgFor({ translation: true, locale: "fr" }));
    expect(eqs).toEqual([]);
  });

  it("filters post translations to the reader locale", () => {
    const { q, eqs } = fakeQuery();
    withTranslationFilters(q, cfgFor({ translation: true }));
    expect(eqs).toEqual([["post_translations.locale", "es-419"]]);
  });

  it("also filters poll option translations with polls on", () => {
    const { q, eqs } = fakeQuery();
    withTranslationFilters(q, cfgFor({ translation: true, polls: true }));
    expect(eqs).toEqual([
      ["post_translations.locale", "es-419"],
      ["poll_options.poll_option_translations.locale", "es-419"],
    ]);
  });
});

describe("threadSelect", () => {
  const embed = "comment_translations(locale, source_locale, content)";

  it("embeds comment translations only when a reader locale resolves", () => {
    expect(threadSelect(cfgFor({ translation: true }))).toContain(embed);
    expect(threadSelect(cfgFor({ translation: false }))).not.toContain("comment_translations");
    expect(threadSelect(cfgFor({ translation: true, locale: "fr" }))).not.toContain(
      "comment_translations",
    );
  });
});
