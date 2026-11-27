import type { Group } from "@rocapine/community-core";
import { describe, expect, it, vi } from "vitest";
import { makeT } from "../i18n";
import {
  closedReason,
  findOrLoadMessage,
  groupByDay,
  quoteExcerpt,
  sendErrorKey,
} from "../utils/chat";

const t = makeT("en");

describe("quoteExcerpt", () => {
  it("keeps the first two lines and ends with … when cut", () => {
    expect(quoteExcerpt("one\ntwo\nthree", false, t)).toBe("one\ntwo…");
  });

  it("cuts at 120 characters", () => {
    const out = quoteExcerpt("a".repeat(200), false, t);
    expect(out).toBe(`${"a".repeat(120)}…`);
  });

  it("leaves a short body as is", () => {
    expect(quoteExcerpt("  hello  ", false, t)).toBe("hello");
  });

  it("shows the deleted copy for a deleted message", () => {
    expect(quoteExcerpt("secret", true, t)).toBe("Message deleted");
  });
});

describe("groupByDay", () => {
  const at = (y: number, m: number, d: number, h: number, min = 0) => ({
    id: `${d}-${h}-${min}`,
    createdAt: new Date(y, m - 1, d, h, min).toISOString(),
  });
  const now = new Date(2026, 10, 27, 12).getTime();

  it("splits at local midnight and labels today and yesterday", () => {
    const groups = groupByDay(
      [at(2026, 11, 27, 0, 5), at(2026, 11, 26, 23, 55), at(2026, 11, 26, 8), at(2026, 11, 20, 9)],
      now,
    );
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([
      ["today", 1],
      ["yesterday", 2],
      ["2026-11-20", 1],
    ]);
  });

  it("returns nothing for no messages", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe("findOrLoadMessage", () => {
  const m = (id: string) => ({ id });

  it("stops at the first page when the message is there", async () => {
    const loadOlder = vi.fn();
    expect(await findOrLoadMessage("b", [[m("a"), m("b")]], loadOlder)).toBe(1);
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it("loads older pages until it finds the message", async () => {
    const loadOlder = vi
      .fn()
      .mockResolvedValueOnce([[m("a")], [m("b")]])
      .mockResolvedValueOnce([[m("a")], [m("b")], [m("c")]]);
    expect(await findOrLoadMessage("c", [[m("a")]], loadOlder)).toBe(2);
    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it("answers null when the history ends", async () => {
    const loadOlder = vi
      .fn()
      .mockResolvedValueOnce([[m("a")], [m("b")]])
      .mockResolvedValue(null);
    expect(await findOrLoadMessage("z", [[m("a")]], loadOlder)).toBeNull();
  });

  it("answers null when a load brings no new page", async () => {
    const loadOlder = vi.fn().mockResolvedValue([[m("a")]]);
    expect(await findOrLoadMessage("z", [[m("a")]], loadOlder)).toBeNull();
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });
});

describe("closedReason (the composer's replacement line)", () => {
  const group = (isMember: boolean) => ({ isMember }) as Group;

  it("shows the removed state on not_a_member", () => {
    expect(closedReason(group(true), "not_a_member", true)).toBe("removed");
    expect(closedReason(group(true), "removed_from_group", true)).toBe("removed");
  });

  it("shows the removed state when the group says I'm not a member any more", () => {
    expect(closedReason(group(false), null, true)).toBe("removed");
    // A preview reader was never a member.
    expect(closedReason(group(false), null, false)).toBeNull();
  });

  it("shows the deleted state for a gone group", () => {
    expect(closedReason(null, null, true)).toBe("groupDeleted");
    expect(closedReason(group(true), "not_found", true)).toBe("groupDeleted");
  });

  it("stays open otherwise (and while the group loads)", () => {
    expect(closedReason(group(true), null, true)).toBeNull();
    expect(closedReason(undefined, "rate_limited", true)).toBeNull();
  });
});

describe("sendErrorKey", () => {
  it("maps the send errors to their copy", () => {
    expect(sendErrorKey("message_too_long")).toBe("chat.error.tooLong");
    expect(sendErrorKey("rate_limited")).toBe("chat.error.rateLimited");
    expect(sendErrorKey("unknown")).toBe("chat.error.generic");
  });
});
