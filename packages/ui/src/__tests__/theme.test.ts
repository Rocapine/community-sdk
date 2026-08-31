import { describe, expect, it } from "vitest";
import { defaultTheme, mergeTheme } from "../theme";

describe("mergeTheme", () => {
  it("deep-merges one color while keeping other defaults", () => {
    const merged = mergeTheme({ colors: { accent: "#f00" } });
    expect(merged.colors.accent).toBe("#f00");
    expect(merged.colors.background).toBe(defaultTheme.colors.background);
    expect(merged.colors.textPrimary).toBe(defaultTheme.colors.textPrimary);
    expect(merged.colors.borderStrong).toBe(defaultTheme.colors.borderStrong);
    expect(merged.fonts).toEqual(defaultTheme.fonts);
    expect(merged.radius).toEqual(defaultTheme.radius);
    expect(merged.spacing).toBe(defaultTheme.spacing);
  });

  it("returns the equivalent of defaultTheme when called with no partial", () => {
    expect(mergeTheme()).toEqual(defaultTheme);
  });

  it("deep-merges shadow while keeping the rest of the shadow defaults", () => {
    const merged = mergeTheme({ shadow: { shadowOpacity: 0.5 } });
    expect(merged.shadow.shadowOpacity).toBe(0.5);
    expect(merged.shadow.shadowColor).toBe(defaultTheme.shadow.shadowColor);
    expect(merged.shadow.shadowOffset).toEqual(defaultTheme.shadow.shadowOffset);
  });

  it("replaces spacing wholesale when provided", () => {
    const spacing = (n: number) => n * 8;
    const merged = mergeTheme({ spacing });
    expect(merged.spacing).toBe(spacing);
    expect(merged.spacing(2)).toBe(16);
  });
});
