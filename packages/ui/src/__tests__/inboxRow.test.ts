import { describe, expect, it, vi } from "vitest";
import { makeT } from "../i18n";

// The built core pulls in JSX; only the time decomposition is needed here.
vi.mock("@rocapine/community-core", async () => import("../../../core/src/time"));
const { inboxRowText } = await import("../utils/inboxRow");

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

  it("reads an official post without an author as news from the team", () => {
    expect(inboxRowText(t, item({ kind: "official_post", actorName: null }), now).title).toBe(
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
