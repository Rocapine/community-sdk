import { describe, expect, it } from "vitest";
import { buildFeedSelect } from "../service";
import { streakDays, streakTier } from "../models";

const DAY = 24 * 60 * 60 * 1000;

describe("streaks", () => {
  it("counts full days since the start", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    expect(streakDays("2026-10-30T00:00:00Z", now)).toBe(0);
    expect(streakDays(new Date(now - 41 * DAY - 1).toISOString(), now)).toBe(41);
    expect(streakDays(new Date(now + DAY).toISOString(), now)).toBe(0);
  });

  it("tiers: bronze under 30, silver 30 to 90, gold beyond", () => {
    expect(streakTier(29)).toBe("bronze");
    expect(streakTier(30)).toBe("silver");
    expect(streakTier(90)).toBe("silver");
    expect(streakTier(91)).toBe("gold");
  });

  it("embeds the author's visible streak only with the module", () => {
    expect(buildFeedSelect(undefined)).not.toContain("streak");
    expect(buildFeedSelect(undefined, false, false, false, true)).toContain(
      "author_streak:profiles!posts_author_id_fkey(visible_streak_started_at)",
    );
  });
});
