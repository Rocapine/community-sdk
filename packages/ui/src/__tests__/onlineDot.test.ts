import { describe, expect, it } from "vitest";
import { onlineDotMetrics, onlineLookupId } from "../utils/onlineDot";

describe("onlineDotMetrics", () => {
  it.each([
    [24, 8, 2],
    [30, 8, 2],
    [40, 10, 2],
    [72, 19, 3],
  ])("size %i → dot %i ring %i", (size, dot, ring) => {
    expect(onlineDotMetrics(size)).toEqual({ dot, ring });
  });
});

describe("onlineLookupId", () => {
  it.each(["post", "comment", "profile"])("looks up the member on %s avatars", (placement) => {
    expect(onlineLookupId(placement, "u1")).toBe("u1");
  });
  it.each(["header", "composer", "reply", "edit", "blocked"])(
    "does no lookup on %s avatars",
    (placement) => {
      expect(onlineLookupId(placement, "u1")).toBeNull();
    },
  );
  it("passes an unknown member through as null", () => {
    expect(onlineLookupId("post", null)).toBeNull();
  });
});
