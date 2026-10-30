import { describe, expect, it } from "vitest";
import { splitMentions, threadRows } from "../utils/threadRows";

const c = (id: string, parentId: string | null = null) => ({ id, parentId });

describe("threadRows", () => {
  it("puts each reply under its root comment, one level deep, in order", () => {
    const rows = threadRows([c("a"), c("b"), c("a1", "a"), c("b1", "b"), c("a2", "a1")]);
    expect(rows.map((r) => [r.comment.id, r.depth])).toEqual([
      ["a", 0],
      ["a1", 1],
      ["a2", 1],
      ["b", 0],
      ["b1", 1],
    ]);
  });

  it("shows a reply whose parent is gone as a top-level comment", () => {
    expect(threadRows([c("x", "missing")]).map((r) => r.depth)).toEqual([0]);
  });
});

describe("splitMentions", () => {
  it("splits @handles out of the text", () => {
    expect(splitMentions("@marie-4821 same here, @luc!")).toEqual([
      { text: "@marie-4821", handle: "marie-4821" },
      { text: " same here, " },
      { text: "@luc", handle: "luc" },
      { text: "!" },
    ]);
  });

  it("leaves emails and lone @ alone", () => {
    expect(splitMentions("write to a@b.co @ me")).toEqual([{ text: "write to a@b.co @ me" }]);
  });
});
