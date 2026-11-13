import { describe, expect, it } from "vitest";
import {
  claimColdStartExpansion,
  coldStartExpansionPending,
  countGluedToLabel,
  resetColdStartExpansion,
  withoutCount,
} from "../utils/onlinePill";

describe("onlinePill", () => {
  it("expands only on the first claim per runtime", () => {
    resetColdStartExpansion();
    expect(claimColdStartExpansion()).toBe(true);
    expect(claimColdStartExpansion()).toBe(false);
  });

  it("reading the cold start is side-effect free (StrictMode renders twice)", () => {
    resetColdStartExpansion();
    expect(coldStartExpansionPending()).toBe(true);
    expect(coldStartExpansionPending()).toBe(true); // a second render sees the same
    claimColdStartExpansion(); // the mount effect
    expect(coldStartExpansionPending()).toBe(false);
    claimColdStartExpansion(); // StrictMode runs the effect twice
    expect(coldStartExpansionPending()).toBe(false);
  });

  it("knows whether the number is glued to the text after it", () => {
    expect(countGluedToLabel("12명 온라인", 12)).toBe(true);
    expect(withoutCount("12명 온라인", 12)).toBe("명 온라인");
    expect(countGluedToLabel("12 online", 12)).toBe(false);
    expect(countGluedToLabel("online: 12", 12)).toBe(false);
    expect(countGluedToLabel("12 en ligne", 12)).toBe(false);
  });

  it("strips the number from the label, whichever side it sits on", () => {
    expect(withoutCount("42 online", 42)).toBe("online");
    expect(withoutCount("online: 42", 42)).toBe("online:");
    expect(withoutCount("42 en ligne", 42)).toBe("en ligne");
  });
});
