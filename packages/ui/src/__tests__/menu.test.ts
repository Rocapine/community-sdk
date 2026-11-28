import { expect, it, vi } from "vitest";
import { menuActions } from "../utils/menu";

it("keeps every action in order, drops Cancel, marks the destructive ones", () => {
  const pin = vi.fn();
  const block = vi.fn();
  const rows = menuActions([
    { text: "Pin", onPress: pin },
    { text: "Message", onPress: () => {} },
    { text: "Report post", onPress: () => {} },
    { text: "Block Sam", style: "destructive", onPress: block },
    { text: "Cancel", style: "cancel" },
  ]);
  expect(rows.map((r) => [r.label, r.destructive])).toEqual([
    ["Pin", false],
    ["Message", false],
    ["Report post", false],
    ["Block Sam", true],
  ]);
  expect(new Set(rows.map((r) => r.key)).size).toBe(4);
  rows[0]!.onPress();
  rows[3]!.onPress();
  expect(pin).toHaveBeenCalledTimes(1);
  expect(block).toHaveBeenCalledTimes(1);
});
