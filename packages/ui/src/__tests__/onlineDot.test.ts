import { describe, expect, it } from "vitest";
import { onlineDotMetrics } from "../utils/onlineDot";

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
