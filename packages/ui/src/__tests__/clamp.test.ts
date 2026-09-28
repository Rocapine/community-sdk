import { describe, expect, it } from "vitest";
import { anyOverflows, linesHeight, reservedHeight, type TextLine } from "../utils/clamp";

const lines = (n: number, lineHeight = 22): TextLine[] =>
  Array.from({ length: n }, (_, i) => ({ y: i * lineHeight, height: lineHeight }));

describe("clamp layout math", () => {
  it("measures clamped and full heights", () => {
    expect(linesHeight(lines(9), 6)).toBe(132);
    expect(linesHeight(lines(9))).toBe(198);
    expect(linesHeight(lines(3), 6)).toBe(66);
    expect(linesHeight([], 6)).toBe(0);
  });

  it("reserves the tallest version so a toggle never changes the height", () => {
    // original 3 lines, translation 4 lines: both fit the clamp → 4 lines reserved
    expect(reservedHeight([lines(3), lines(4)], 6, false)).toBe(88);
    // one version overflows: collapsed reserves the clamp, expanded the longest
    expect(reservedHeight([lines(5), lines(9)], 6, false)).toBe(132);
    expect(reservedHeight([lines(5), lines(9)], 6, true)).toBe(198);
  });

  it("reserves nothing until every version is measured", () => {
    expect(reservedHeight([lines(3), null], 6, false)).toBeUndefined();
    expect(reservedHeight([], 6, false)).toBeUndefined();
  });

  it("offers View more when any version overflows", () => {
    expect(anyOverflows([lines(5), lines(7)], 6)).toBe(true);
    expect(anyOverflows([lines(6), lines(6)], 6)).toBe(false);
    expect(anyOverflows([lines(7), null], 6)).toBe(true);
  });
});
