// Optimistic rows carry our own uid/avatar (so tapping our just-sent post
// opens our profile, not an empty-id route), and `isOptimistic` is the marker
// server-keyed actions wait on now that `authorId` is no longer "".
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { isOptimistic, ownAuthorFields } from "../hooks";

describe("optimistic rows", () => {
  it("fills author fields from the cached uid and profile", () => {
    const qc = new QueryClient();
    qc.setQueryData(["community", "myUid"], "u1");
    qc.setQueryData(["community", "profile", "u1"], {
      id: "u1",
      name: "Ann",
      handle: "ann-1",
      official: false,
      bio: null,
      avatarUrl: "https://x/a.jpg",
    });
    expect(ownAuthorFields(qc)).toEqual({
      authorId: "u1",
      authorHandle: "ann-1",
      authorAvatarUrl: "https://x/a.jpg",
    });
  });

  it("falls back to an empty author before identity resolves", () => {
    expect(ownAuthorFields(new QueryClient())).toEqual({
      authorId: "",
      authorHandle: null,
      authorAvatarUrl: null,
    });
  });

  it("recognizes temp ids only", () => {
    expect(isOptimistic({ id: "optimistic-123" })).toBe(true);
    expect(isOptimistic({ id: "3f2c-uuid" })).toBe(false);
  });
});
