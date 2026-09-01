import { describe, expect, it } from "vitest";
import { timeAgo, timeAgoParts } from "../time";

const NOW = Date.parse("2026-07-02T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 3_600_000;

describe("timeAgo", () => {
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  it("formats now / minutes / hours / days", () => {
    expect(timeAgo(iso(30_000), NOW)).toBe("now");
    expect(timeAgo(iso(12 * MIN), NOW)).toBe("12m");
    expect(timeAgo(iso(5 * HOUR), NOW)).toBe("5h");
    expect(timeAgo(iso(72 * HOUR), NOW)).toBe("3d");
  });
});

describe("timeAgoParts", () => {
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  it("decomposes into a language-free unit + value", () => {
    expect(timeAgoParts(iso(30_000), NOW)).toEqual({ unit: "now", value: 0 });
    expect(timeAgoParts(iso(12 * MIN), NOW)).toEqual({ unit: "minute", value: 12 });
    expect(timeAgoParts(iso(5 * HOUR), NOW)).toEqual({ unit: "hour", value: 5 });
    expect(timeAgoParts(iso(72 * HOUR), NOW)).toEqual({ unit: "day", value: 3 });
  });
});
