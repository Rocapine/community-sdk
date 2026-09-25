import { describe, expect, it } from "vitest";
import {
  FEED_KEY,
  feedKey,
  SEARCH_KEY,
  searchKey,
  threadKey,
  USER_POSTS_KEY,
  userPostsKey,
} from "../keys";

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => key[i] === part);

describe("query keys", () => {
  const full = (locale: string | null) => [
    feedKey("news", locale),
    feedKey(undefined, locale),
    threadKey("p1", locale),
    userPostsKey("u1", locale),
    searchKey("hello", locale),
  ];

  it("end with the reader locale, or 'src' when there is none", () => {
    for (const key of full("es-419")) expect(key[key.length - 1]).toBe("es-419");
    for (const key of full(null)) expect(key[key.length - 1]).toBe("src");
    expect(feedKey()).toEqual(["community", "feed", "all", "src"]);
  });

  it("keep the prefix keys as prefixes, so setQueriesData/invalidate still match", () => {
    expect(startsWith(feedKey("news", "pl"), FEED_KEY)).toBe(true);
    expect(startsWith(userPostsKey("u1", "pl"), USER_POSTS_KEY)).toBe(true);
    expect(startsWith(searchKey("hi", "pl"), SEARCH_KEY)).toBe(true);
  });

  it("differ between two locales", () => {
    const [a, b] = [full("en"), full("pl")];
    a.forEach((key, i) => expect(key).not.toEqual(b[i]));
  });
});
