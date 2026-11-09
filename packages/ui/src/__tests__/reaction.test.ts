import { describe, expect, it } from "vitest";
import { reactionLabel, reactionState } from "../utils/reaction";

describe("reactionState", () => {
  it("reads the post's reaction", () => {
    expect(reactionState({ hasReacted: true, reactionCount: 4 })).toEqual({
      active: true,
      count: 4,
    });
    expect(reactionState({ hasReacted: false, reactionCount: 0 })).toEqual({
      active: false,
      count: 0,
    });
  });
});

describe("reactionLabel", () => {
  it("is the module's label, or nothing", () => {
    expect(reactionLabel({ key: "yum", label: "Yum" })).toBe("Yum");
    expect(reactionLabel({ key: "cheer" })).toBeNull();
    expect(reactionLabel({ key: "cheer", label: "  " })).toBeNull();
    expect(reactionLabel(false)).toBeNull();
  });
});
