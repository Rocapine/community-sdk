import { describe, expect, it } from "vitest";
import {
  claimColdStartExpansion,
  resetColdStartExpansion,
  withoutCount,
} from "../utils/onlinePill";

describe("onlinePill", () => {
  it("expands only on the first claim per runtime", () => {
    resetColdStartExpansion();
    expect(claimColdStartExpansion()).toBe(true);
    expect(claimColdStartExpansion()).toBe(false);
  });

  it("strips the number from the label, whichever side it sits on", () => {
    expect(withoutCount("42 online", 42)).toBe("online");
    expect(withoutCount("online: 42", 42)).toBe("online:");
    expect(withoutCount("42 en ligne", 42)).toBe("en ligne");
  });
});
