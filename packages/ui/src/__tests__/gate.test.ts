// Coverage for the pre-submit gate hook's merge/abort logic
// (`ThreadSheet`'s `beforeSubmitComment`) and the `+` button's gates,
// pulled out into `runGuarded` (`../utils/gate`) so it's testable without
// mounting either React Native screen. See that file's doc comment for the
// full contract.
import { describe, expect, it, vi } from "vitest";
import { openComposerGuarded, runGuarded } from "../utils/gate";

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

describe("openComposerGuarded", () => {
  it("asks for the rules first and stops if they are declined", async () => {
    const beforeCompose = vi.fn(async () => true);
    expect(
      await openComposerGuarded({
        rulesAccepted: false,
        requestRules: async () => false,
        beforeCompose,
      }),
    ).toBe(false);
    expect(beforeCompose).not.toHaveBeenCalled();
  });

  it("runs the host gate once the rules are accepted", async () => {
    const beforeCompose = vi.fn(async () => true);
    expect(
      await openComposerGuarded({
        rulesAccepted: false,
        requestRules: async () => true,
        beforeCompose,
      }),
    ).toBe(true);
    expect(beforeCompose).toHaveBeenCalledOnce();
  });

  it("does not ask for rules already accepted", async () => {
    const requestRules = vi.fn(async () => true);
    expect(await openComposerGuarded({ rulesAccepted: true, requestRules })).toBe(true);
    expect(requestRules).not.toHaveBeenCalled();
  });

  it("a host gate that says no or throws keeps the composer closed", async () => {
    const requestRules = async () => true;
    expect(
      await openComposerGuarded({
        rulesAccepted: true,
        requestRules,
        beforeCompose: async () => false,
      }),
    ).toBe(false);
    expect(
      await openComposerGuarded({
        rulesAccepted: true,
        requestRules,
        beforeCompose: async () => {
          throw new Error("x");
        },
      }),
    ).toBe(false);
  });
});
