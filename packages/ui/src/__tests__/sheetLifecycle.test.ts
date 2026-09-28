import { describe, expect, it } from "vitest";
import { sheetTransition } from "../utils/sheetLifecycle";

describe("sheetTransition", () => {
  it("does nothing when visible did not change", () => {
    expect(sheetTransition(true, true, "open")).toBeNull();
    expect(sheetTransition(false, false, "hidden")).toBeNull();
    expect(sheetTransition(false, false, "open")).toBeNull();
  });

  it("mounts when opened from nothing", () => {
    expect(sheetTransition(false, true, "hidden")).toBe("mount");
  });

  it("closes an open sheet", () => {
    expect(sheetTransition(true, false, "open")).toBe("close");
  });

  it("ignores a close when already hidden (user-initiated close came first)", () => {
    expect(sheetTransition(true, false, "hidden")).toBeNull();
  });

  it("snaps back open when re-opened mid close animation", () => {
    expect(sheetTransition(false, true, "open")).toBe("reopen");
  });

  it("defers everything while the Modal is being dismissed", () => {
    expect(sheetTransition(false, true, "dismissing")).toBeNull();
    expect(sheetTransition(true, false, "dismissing")).toBeNull();
  });
});
