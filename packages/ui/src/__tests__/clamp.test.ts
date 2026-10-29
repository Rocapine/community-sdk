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

  it("cuts on the measured character edges when they are known (web)", () => {
    // Ten 10pt characters then twenty 5pt ones: 200pt over 30 characters.
    const charEnds = [
      ...Array.from({ length: 10 }, (_, i) => (i + 1) * 10),
      ...Array.from({ length: 20 }, (_, i) => 100 + (i + 1) * 5),
    ];
    const last = { text: "w".repeat(10) + "i".repeat(20), width: 200, charEnds };
    // Room before the "… View more" suffix: 300 − 100 = 200, then 200 − 100 = 100.
    expect(clampWithSuffix([line("a "), last, line("end")], 2, 300, 100)).toBe(
      "a " + last.text + "…",
    );
    expect(clampWithSuffix([line("a "), last, line("end")], 2, 200, 100)).toBe(
      "a " + "w".repeat(10) + "…",
    );
  });
});
