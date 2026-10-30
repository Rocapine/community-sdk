import { describe, expect, it } from "vitest";
import { timeAgo, timeAgoParts } from "../time";

const NOW = Date.parse("2026-07-02T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("timeAgo", () => {
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  it("formats now / seconds / minutes / hours / days", () => {
    expect(timeAgo(iso(500), NOW)).toBe("now");
    expect(timeAgo(iso(30_000), NOW)).toBe("30s");
    expect(timeAgo(iso(12 * MIN), NOW)).toBe("12m");
    expect(timeAgo(iso(5 * HOUR), NOW)).toBe("5h");
    expect(timeAgo(iso(72 * HOUR), NOW)).toBe("3d");
  });

  it("keeps a compact English label for every unit", () => {
    expect(timeAgo(iso(5_000), NOW)).toBe("5s");
    expect(timeAgo(iso(60 * DAY), NOW)).toBe("2mo");
    expect(timeAgo(iso(400 * DAY), NOW)).toBe("1y");
  });
});

describe("timeAgoParts", () => {
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  it("decomposes into a language-free unit + value", () => {
    expect(timeAgoParts(iso(30_000), NOW)).toEqual({ unit: "second", value: 30 });
    expect(timeAgoParts(iso(12 * MIN), NOW)).toEqual({ unit: "minute", value: 12 });
    expect(timeAgoParts(iso(5 * HOUR), NOW)).toEqual({ unit: "hour", value: 5 });
    expect(timeAgoParts(iso(72 * HOUR), NOW)).toEqual({ unit: "day", value: 3 });
  });

  it("covers every unit and moves on exactly at 1", () => {
    expect(timeAgoParts(iso(500), NOW)).toEqual({ unit: "now", value: 0 });
    expect(timeAgoParts(iso(1_000), NOW)).toEqual({ unit: "second", value: 1 });
    expect(timeAgoParts(iso(59_999), NOW)).toEqual({ unit: "second", value: 59 });
    expect(timeAgoParts(iso(MIN), NOW)).toEqual({ unit: "minute", value: 1 });
    expect(timeAgoParts(iso(23 * HOUR + 59 * MIN), NOW)).toEqual({ unit: "hour", value: 23 });
    expect(timeAgoParts(iso(29 * DAY), NOW)).toEqual({ unit: "day", value: 29 });
    expect(timeAgoParts(iso(30 * DAY), NOW)).toEqual({ unit: "month", value: 1 });
    expect(timeAgoParts(iso(364 * DAY), NOW)).toEqual({ unit: "month", value: 11 });
    expect(timeAgoParts(iso(365 * DAY), NOW)).toEqual({ unit: "year", value: 1 });
    expect(timeAgoParts(iso(800 * DAY), NOW)).toEqual({ unit: "year", value: 2 });
  });

  it("a future timestamp (clock skew) is now", () => {
    expect(timeAgoParts(new Date(NOW + 5_000).toISOString(), NOW)).toEqual({
      unit: "now",
      value: 0,
    });
  });
});
