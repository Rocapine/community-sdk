import { describe, expect, it } from "vitest";
import { DEFAULT_FEED_HEADER, resolveHeaderZones } from "../utils/headerZones";

const logo = { logo: 1, accessibilityLabel: "Eve" };

describe("resolveHeaderZones", () => {
  it("drops the inbox when the inbox module is off", () => {
    const zones = resolveHeaderZones(
      { left: ["profile"], right: ["search", "inbox"] },
      { inbox: false },
    );
    expect(zones.right).toEqual(["search"]);
  });

  it("keeps logos and the order of each zone", () => {
    const zones = resolveHeaderZones(
      { left: [logo], center: ["title"], right: ["inbox", "search"] },
      { inbox: true },
    );
    expect(zones).toEqual({
      left: [logo],
      center: ["title"],
      right: ["inbox", "search"],
      visible: true,
    });
  });

  it("hides the row when every zone ends up empty", () => {
    expect(resolveHeaderZones({ right: ["inbox"] }, { inbox: false }).visible).toBe(false);
    expect(resolveHeaderZones({ left: [] }, { inbox: true })).toEqual({
      left: [],
      center: [],
      right: [],
      visible: false,
    });
  });

  it("keeps the default zones when the config sets none (only a background, say)", () => {
    const zones = resolveHeaderZones(
      { background: { color: "#000" }, topInset: 47 },
      { inbox: true },
    );
    expect(zones).toEqual({
      left: ["profile"],
      center: ["title"],
      right: ["search", "inbox"],
      visible: true,
    });
  });

  it("defaults to profile, title, search and inbox", () => {
    expect(resolveHeaderZones(DEFAULT_FEED_HEADER, { inbox: true })).toMatchObject({
      left: ["profile"],
      center: ["title"],
      right: ["search", "inbox"],
    });
  });
});
