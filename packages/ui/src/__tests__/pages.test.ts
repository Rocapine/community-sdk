import { expect, it } from "vitest";
import { uniqueById } from "../utils/pages";

it("flattens pages and drops later duplicates by id", () => {
  const a = { id: "a", n: 1 };
  const b = { id: "b", n: 2 };
  const aAgain = { id: "a", n: 3 };
  expect(
    uniqueById([
      [a, b],
      [aAgain, { id: "c", n: 4 }],
    ]),
  ).toEqual([a, b, { id: "c", n: 4 }]);
});

it("returns an empty list for undefined pages", () => {
  expect(uniqueById(undefined)).toEqual([]);
});
