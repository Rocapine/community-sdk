import { describe, expect, it } from "vitest";
import { clampWithSuffix } from "../utils/clamp";

// Lines as `onTextLayout` returns them (each keeps its trailing space), at
// 10pt per character so the widths are easy to follow.
const line = (text: string) => ({ text, width: text.length * 10 });

describe("clampWithSuffix", () => {
  it("returns null when the text fits", () => {
    expect(clampWithSuffix([line("a b "), line("c")], 6, 300, 90)).toBeNull();
  });

  it("keeps a short last line whole and appends an ellipsis", () => {
    const lines = [line("one "), line("two "), line("three "), line("four")];
    expect(clampWithSuffix(lines, 2, 300, 90)).toBe("one two…");
  });

  it("trims the last visible line so the suffix fits on it, with slack", () => {
    // 300 − 90 = 210pt → 21 average characters, minus 3 of slack (the "…"
    // and glyphs wider than the line's average) → 18.
    const long = "x".repeat(30); // a full line with no space (a URL, a long word)
    expect(clampWithSuffix([line(long), line(long), line("end")], 2, 300, 90)).toBe(
      long + "x".repeat(18) + "…",
    );
  });
});
