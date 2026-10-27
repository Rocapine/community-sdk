import { describe, expect, it } from "vitest";
import { initialOf } from "../utils/initial";

describe("initialOf", () => {
  it("upper-cases the first character, after leading spaces", () => {
    expect(initialOf("marie")).toBe("M");
    expect(initialOf("  élodie")).toBe("É");
  });

  it("keeps a whole emoji (first code point, not a lone surrogate)", () => {
    expect(initialOf("😀 Joy")).toBe("😀");
  });

  it("falls back to ? when there is no name", () => {
    expect(initialOf("")).toBe("?");
    expect(initialOf("   ")).toBe("?");
  });
});
