import { describe, expect, it } from "vitest";
import { makeT } from "../i18n";

describe("makeT", () => {
  it("resolves a key from the en catalog", () => {
    const t = makeT("en");
    expect(t("rules.accept")).toBe("I agree, take me in");
  });

  it("override wins over the catalog", () => {
    const t = makeT("en", { "rules.accept": "Yes, I'm in" });
    expect(t("rules.accept")).toBe("Yes, I'm in");
  });

  it("falls back to en for an unknown locale", () => {
    const t = makeT("fr");
    expect(t("rules.accept")).toBe("I agree, take me in");
  });

  it("returns the key itself when missing everywhere", () => {
    const t = makeT("en");
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("interpolates {param} placeholders", () => {
    const t = makeT("en");
    expect(t("menu.blockUser", { name: "Alex" })).toBe("Block Alex");
  });

  it("picks .one at count 1 and .other at 0 and 2", () => {
    const t = makeT("en");
    expect(t("poll.votes", { count: 1 })).toBe("1 vote");
    expect(t("poll.votes", { count: 0 })).toBe("0 votes");
    expect(t("poll.votes", { count: 2 })).toBe("2 votes");
  });

  it("plural resolution still honors overrides", () => {
    const t = makeT("en", { "poll.votes.other": "{count} ballots" });
    expect(t("poll.votes", { count: 3 })).toBe("3 ballots");
  });
});
