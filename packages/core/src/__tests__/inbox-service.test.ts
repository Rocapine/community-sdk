import { describe, expect, it } from "vitest";
import { unreadCount, type InboxItem } from "../inbox-service";

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "n1",
  kind: "like",
  createdAt: "2026-08-20T10:00:00Z",
  actorName: "Hannah",
  postId: "p1",
  payload: {},
  ...over,
});

describe("unreadCount", () => {
  it("counts every item when seenAt is null (never opened)", () => {
    const items = [item({ id: "n1" }), item({ id: "n2" })];
    expect(unreadCount(items, null)).toBe(2);
  });

  it("counts only items created after seenAt", () => {
    const items = [
      item({ id: "n1", createdAt: "2026-08-20T09:00:00Z" }), // before
      item({ id: "n2", createdAt: "2026-08-20T11:00:00Z" }), // after
      item({ id: "n3", createdAt: "2026-08-20T12:00:00Z" }), // after
    ];
    expect(unreadCount(items, "2026-08-20T10:00:00Z")).toBe(2);
  });

  it("excludes an item created exactly at seenAt (at-or-before is read)", () => {
    const items = [item({ id: "n1", createdAt: "2026-08-20T10:00:00Z" })];
    expect(unreadCount(items, "2026-08-20T10:00:00Z")).toBe(0);
  });

  it("returns 0 for an empty inbox", () => {
    expect(unreadCount([], null)).toBe(0);
    expect(unreadCount([], "2026-08-20T10:00:00Z")).toBe(0);
  });
});
