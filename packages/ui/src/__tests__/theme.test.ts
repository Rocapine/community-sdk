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

describe("typography", () => {
  it("derives every role from fonts and fontWeights", () => {
    const th = mergeTheme({
      fonts: { serifBold: "Orbitron", regular: "Inter", medium: "Inter-Medium" },
      fontWeights: { bold: "700" },
    });
    expect(th.typography.title).toMatchObject({
      fontFamily: "Orbitron",
      fontWeight: "700",
      fontSize: 20,
    });
    expect(th.typography.body).toMatchObject({ fontFamily: "Inter", fontSize: 15 });
    expect(th.typography.label).toMatchObject({ fontFamily: "Inter-Medium", fontSize: 15 });
    expect(th.typography.display.fontSize).toBe(24);
    expect(th.typography.heading.fontSize).toBe(22);
    expect(th.typography.bodySmall.fontSize).toBe(14);
    expect(th.typography.meta.fontSize).toBe(13);
    expect(th.typography.caption.fontSize).toBe(12);
  });

  it("overrides one field of one role and keeps the rest", () => {
    const th = mergeTheme({
      fonts: { serifBold: "Orbitron" },
      typography: { title: { fontFamily: "System" } },
    });
    expect(th.typography.title).toMatchObject({ fontFamily: "System", fontSize: 20 });
    expect(th.typography.heading).toMatchObject({ fontFamily: "Orbitron", fontSize: 22 });
  });

  it("keeps the system font when no fonts are set", () => {
    expect(defaultTheme.typography.body.fontFamily).toBeUndefined();
    expect(defaultTheme.typography.title.fontWeight).toBe(defaultTheme.fontWeights.bold);
  });
});
