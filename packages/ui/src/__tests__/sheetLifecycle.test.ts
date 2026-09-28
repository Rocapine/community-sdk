import { describe, expect, it } from "vitest";
import { sheetTransition } from "../utils/sheetLifecycle";

describe("sheetTransition", () => {
  it("does nothing when visible did not change", () => {
    expect(sheetTransition(true, true, true)).toBeNull();
    expect(sheetTransition(false, false, false)).toBeNull();
    expect(sheetTransition(false, false, true)).toBeNull();
  });

  it("mounts when opened from nothing", () => {
    expect(sheetTransition(false, true, false)).toBe("mount");
  });

  it("closes a mounted sheet", () => {
    expect(sheetTransition(true, false, true)).toBe("close");
  });

  it("ignores a close when already unmounted (user-initiated close came first)", () => {
    expect(sheetTransition(true, false, false)).toBeNull();
  });

  it("snaps back open when re-opened mid close animation", () => {
    expect(sheetTransition(false, true, true)).toBe("reopen");
  });
});
