// Coverage for the pre-submit gate hook's merge/abort logic
// (`ComposerCard`'s `beforeSubmit` / `ThreadSheet`'s `beforeSubmitComment`),
// pulled out into `runGuarded` (`../utils/gate`) so it's testable without
// mounting either React Native screen. See that file's doc comment for the
// full contract.
import { describe, expect, it, vi } from "vitest";
import { runGuarded } from "../utils/gate";

describe("runGuarded", () => {
  it("runs the action when no gate is provided", async () => {
    const action = vi.fn();
    const allowed = await runGuarded(undefined, { topic: "general", body: "hi" }, action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(allowed).toBe(true);
  });

  it("runs the action when the gate resolves true", async () => {
    const gate = vi.fn().mockResolvedValue(true);
    const action = vi.fn();
    const draft = { postId: "p1", body: "hi" };
    const allowed = await runGuarded(gate, draft, action);
    expect(gate).toHaveBeenCalledWith(draft);
    expect(action).toHaveBeenCalledTimes(1);
    expect(allowed).toBe(true);
  });

  it("does not run the action when the gate resolves false", async () => {
    const gate = vi.fn().mockResolvedValue(false);
    const action = vi.fn();
    const allowed = await runGuarded(gate, { topic: "general", body: "hi" }, action);
    expect(action).not.toHaveBeenCalled();
    expect(allowed).toBe(false);
  });

  it("does not run the action when the gate rejects, and never throws/unhandled-rejects", async () => {
    const gate = vi.fn().mockRejectedValue(new Error("paywall check failed"));
    const action = vi.fn();
    await expect(runGuarded(gate, { topic: "general", body: "hi" }, action)).resolves.toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("passes the exact draft through to the gate untouched", async () => {
    const gate = vi.fn().mockResolvedValue(true);
    const draft = { topic: "prayer", body: "please pray", pollOptions: ["a", "b"] };
    await runGuarded(gate, draft, () => {});
    expect(gate).toHaveBeenCalledWith(draft);
  });
});
