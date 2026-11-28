import { describe, expect, it, vi } from "vitest";
import { makeT } from "../i18n";

// The built core pulls in JSX; only the time decomposition is needed here.
vi.mock("@rocapine/community-core", async () => import("../../../core/src/time"));
const { inboxRowText, inboxRowTarget } = await import("../utils/inboxRow");

const t = makeT("en");
const now = Date.parse("2026-11-04T12:00:00Z");
const item = (extra: Record<string, unknown>) => ({
  id: "n1",
  kind: "like",
  createdAt: "2026-11-04T09:00:00Z",
  actorName: "Marie",
  postId: "p1",
  payload: {},
  ...extra,
});

describe("inboxRowText", () => {
  it("names the actor and the time", () => {
    expect(inboxRowText(t, item({}), now)).toEqual({
      title: "Marie liked your post",
      excerpt: null,
      timeLabel: "3h",
    });
  });

  it("reads an admin post without an author as news from the team", () => {
    expect(inboxRowText(t, item({ kind: "admin_post", actorName: null }), now).title).toBe(
      "News from the team",
    );
  });

  it("keeps the post excerpt", () => {
    expect(
      inboxRowText(t, item({ kind: "comment", payload: { postExcerpt: "Morning run" } }), now)
        .excerpt,
    ).toBe("Morning run");
  });

  it("has no title for a kind the SDK doesn't know", () => {
    expect(inboxRowText(t, item({ kind: "badge_earned" }), now).title).toBe("");
  });
});

describe("group events", () => {
  it("reads an approved group and opens it", () => {
    const row = item({ kind: "group_approved", actorName: null, postId: null, groupId: "g1" });
    expect(inboxRowText(t, row, now).title).toBe(
      "Your group was approved. Everyone can find it now.",
    );
    expect(inboxRowTarget(row, "readOnly")).toEqual({ groupId: "g1" });
  });

  it("opens a rejected group to fix it", () => {
    const row = item({ kind: "group_field_rejected", postId: null, groupId: "g1" });
    expect(inboxRowText(t, row, now).title).toBe(
      "Part of your group wasn't accepted. Tap to change it.",
    );
    expect(inboxRowTarget(row, "none")).toEqual({ groupId: "g1" });
  });

  it("opens a removed member's group as a preview, or nothing without previews", () => {
    const row = item({ kind: "group_member_removed", postId: null, groupId: "g1" });
    expect(inboxRowText(t, row, now).title).toBe("You were removed from a group.");
    expect(inboxRowTarget(row, "readOnly")).toEqual({ groupId: "g1", preview: true });
    expect(inboxRowTarget(row, "none")).toBeNull();
  });

  it("has no target without a group id (an inbox older than the column)", () => {
    expect(inboxRowTarget(item({ kind: "group_approved", postId: null }), "readOnly")).toBeNull();
  });

  it("opens a post row's post", () => {
    expect(inboxRowTarget(item({}), "readOnly")).toEqual({ postId: "p1" });
  });
});
