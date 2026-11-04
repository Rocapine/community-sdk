import { describe, expect, it } from "vitest";
import { badgeToggleLabel, badgesFor } from "../utils/badges";

const declared = {
  streak: { placements: ["post", "profile"] as const },
  bestStreak: { placements: ["profile"] as const },
  rank: { placements: ["post", "comment", "profile"] as const },
};
const data = {
  rank: { n: 3 },
  streak: { since: "2026-10-01T00:00:00Z" },
  bestStreak: { days: 41 },
  stray: { x: 1 },
};

describe("badgesFor", () => {
  it("keeps the declared order and the placement", () => {
    expect(badgesFor("post", declared, data)).toEqual([
      { key: "streak", data: data.streak },
      { key: "rank", data: data.rank },
    ]);
    expect(badgesFor("comment", declared, data)).toEqual([{ key: "rank", data: data.rank }]);
    expect(badgesFor("profile", declared, data).map((b) => b.key)).toEqual([
      "streak",
      "bestStreak",
      "rank",
    ]);
  });

  it("skips undeclared keys and declared keys without data", () => {
    expect(badgesFor("post", declared, { stray: { x: 1 } })).toEqual([]);
  });

  it("shows nothing without data or without the module", () => {
    expect(badgesFor("post", declared, undefined)).toEqual([]);
    expect(badgesFor("post", false, data)).toEqual([]);
    expect(badgesFor("post", undefined, data)).toEqual([]);
  });
});

describe("badgeToggleLabel", () => {
  const strings: Record<string, string> = {
    "badge.streak.toggle": "Show my streak",
    "badge.rank.label": "Rank",
  };
  const t = (key: string) => strings[key] ?? key;

  it("prefers the toggle string, then the badge's label, then its id", () => {
    expect(badgeToggleLabel(t, "streak")).toBe("Show my streak");
    expect(badgeToggleLabel(t, "rank")).toBe("Rank");
    expect(badgeToggleLabel(t, "zodiac")).toBe("zodiac");
  });
});
