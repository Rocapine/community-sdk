import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveConfig, STREAK_BADGES, type CommunityConfig } from "../config";
import { resetIdentity, syncProfileFromHost } from "../identity";
import {
  mapCommentRow,
  mapPostRow,
  mapProfileRow,
  streakBadgeData,
  streakDays,
  streakTier,
} from "../models";
import { buildFeedSelect, setBadgeVisibility, threadSelect } from "../service";

const DAY = 24 * 60 * 60 * 1000;

describe("streak helpers", () => {
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

  it("turns a host streak into the two streak badges", () => {
    expect(streakBadgeData({ startedAt: "2026-10-01T00:00:00Z", bestDays: 41.7 })).toEqual({
      streak: { since: "2026-10-01T00:00:00Z" },
      bestStreak: { days: 41 },
    });
    expect(streakBadgeData({ startedAt: null, bestDays: 0 })).toEqual({});
  });

  it("declares the streak on posts and the profile, the best streak on the profile", () => {
    expect(STREAK_BADGES).toEqual({
      streak: { placements: ["post", "profile"] },
      bestStreak: { placements: ["profile"] },
    });
  });
});

const base = {
  supabase: null,
  appName: "t",
  topics: [],
  modules: { polls: false, push: false, inbox: false, reaction: false as const },
};

describe("selects", () => {
  it("embeds the author's visible badges only with the module", () => {
    expect(buildFeedSelect(undefined)).not.toContain("badges");
    const select = buildFeedSelect(undefined, false, false, false, true);
    expect(select).toContain("author_badges:profiles!posts_author_id_fkey(visible_badges)");
    expect(select).not.toContain("streak");
  });

  it("adds the comment author's visible badges only with the module", () => {
    const on = resolveConfig({ ...base, modules: { ...base.modules, badges: STREAK_BADGES } });
    const off = resolveConfig(base);
    expect(threadSelect(on)).toContain(
      "profiles(username, is_admin, handle, avatar_url, visible_badges)",
    );
    expect(threadSelect(off)).not.toContain("visible_badges");
  });
});

const postRow = (extra: Record<string, unknown> = {}) =>
  ({
    id: "p1",
    author_id: "u1",
    content: "hi",
    topic: null,
    status: "visible",
    created_at: "2026-11-01T00:00:00Z",
    pinned_at: null,
    profiles: { username: "Ana", is_admin: false, handle: "ana", avatar_url: null },
    likes: [],
    comments: [],
    ...extra,
  }) as never;

describe("mapping", () => {
  it("maps a post author's badges, {} without the embed", () => {
    const badges = { streak: { since: "2026-10-01T00:00:00Z" } };
    expect(
      mapPostRow(postRow({ author_badges: { visible_badges: badges } }), "me", "x", [], new Set())
        .authorBadges,
    ).toEqual(badges);
    expect(mapPostRow(postRow(), "me", "x", [], new Set()).authorBadges).toEqual({});
  });

  it("maps a comment author's badges", () => {
    const row = {
      id: "c1",
      post_id: "p1",
      author_id: "u1",
      content: "hey",
      status: "visible",
      created_at: "2026-11-01T00:00:00Z",
      profiles: {
        username: "Ana",
        is_admin: false,
        handle: "ana",
        avatar_url: null,
        visible_badges: { rank: { n: 2 } },
      },
    } as never;
    expect(mapCommentRow(row, "me", "x").authorBadges).toEqual({ rank: { n: 2 } });
  });

  it("maps a profile's visible badges and hidden ids", () => {
    const profile = mapProfileRow(
      {
        id: "u1",
        username: "Ana",
        handle: "ana",
        is_admin: false,
        bio: null,
        avatar_url: null,
        visible_badges: { streak: { since: "2026-10-01T00:00:00Z" } },
        hidden_badges: ["bestStreak"],
      },
      "x",
    );
    expect(profile.badges).toEqual({ streak: { since: "2026-10-01T00:00:00Z" } });
    expect(profile.hiddenBadges).toEqual(["bestStreak"]);
  });
});

type Calls = { update?: Record<string, unknown>; selected?: string };

function fakeClient(calls: Calls, hidden: string[] = []): SupabaseClient {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: "uid1" } } } }) },
    from: () => ({
      select: (columns: string) => {
        calls.selected = columns;
        return {
          eq: () => ({ single: async () => ({ data: { hidden_badges: hidden }, error: null }) }),
        };
      },
      update: (payload: Record<string, unknown>) => {
        calls.update = payload;
        return { eq: async () => ({ error: null }) };
      },
    }),
  } as unknown as SupabaseClient;
}

const withBadges = (supabase: SupabaseClient, host: CommunityConfig["host"] = {}) =>
  resolveConfig({
    ...base,
    supabase,
    modules: { ...base.modules, badges: STREAK_BADGES },
    host: { getDisplayName: () => null, getAnalyticsIds: () => ({}), ...host },
  });

describe("syncProfileFromHost — badges", () => {
  beforeEach(() => resetIdentity());

  it("writes the host's badges, once per change", async () => {
    let badges = { streak: { since: "2026-10-01T00:00:00Z" } };
    const calls: Calls = {};
    const cfg = withBadges(fakeClient(calls), { getBadges: () => badges });
    await syncProfileFromHost(cfg);
    expect(calls.update).toMatchObject({ badges });
    calls.update = undefined;
    await syncProfileFromHost(cfg);
    expect(calls.update?.badges).toBeUndefined();
    badges = { streak: { since: "2026-10-02T00:00:00Z" } };
    await syncProfileFromHost(cfg);
    expect(calls.update).toMatchObject({ badges });
  });
});

describe("setBadgeVisibility", () => {
  it("adds a hidden badge to the stored list", async () => {
    const calls: Calls = {};
    await setBadgeVisibility(withBadges(fakeClient(calls, ["rank"])), {
      key: "bestStreak",
      visible: false,
    });
    expect(calls.selected).toBe("hidden_badges");
    expect(calls.update).toEqual({ hidden_badges: ["rank", "bestStreak"] });
  });

  it("removes it to show the badge again", async () => {
    const calls: Calls = {};
    await setBadgeVisibility(withBadges(fakeClient(calls, ["bestStreak", "rank"])), {
      key: "bestStreak",
      visible: true,
    });
    expect(calls.update).toEqual({ hidden_badges: ["rank"] });
  });

  it("refuses without the badges module", async () => {
    await expect(
      setBadgeVisibility(resolveConfig({ ...base, supabase: fakeClient({}) }), {
        key: "x",
        visible: true,
      }),
    ).rejects.toThrow("badges module is not enabled");
  });
});
