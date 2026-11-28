import type { Group } from "@rocapine/community-core";
import { describe, expect, it, vi } from "vitest";
import { makeT } from "../i18n";
import {
  canDeleteMessage,
  closedReason,
  dayLabel,
  screenErrorCode,
  findOrLoadMessage,
  groupByDay,
  msUntilNextDay,
  quoteExcerpt,
  replyPreview,
  runFlags,
  sendErrorKey,
  shownInList,
} from "../utils/chat";
import {
  SWIPE_ARMED_OFFSET,
  SWIPE_EDGE,
  SWIPE_MAX,
  SWIPE_REPLY_AT,
  hitsControl,
  startsAtEdge,
  swipeOffset,
  swipeTriggered,
} from "../utils/chatGestures";

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

  it("splits at local midnight", () => {
    const groups = groupByDay([
      at(2026, 11, 27, 0, 5),
      at(2026, 11, 26, 23, 55),
      at(2026, 11, 26, 8),
      at(2026, 11, 20, 9),
    ]);
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([
      ["2026-11-27", 1],
      ["2026-11-26", 2],
      ["2026-11-20", 1],
    ]);
  });

  it("returns nothing for no messages", () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe("dayLabel", () => {
  const today = "2026-11-27"; // a Friday
  const fr = makeT("fr");

  it("says Today and Yesterday from the locale files", () => {
    expect(dayLabel("2026-11-27", today, "en", t)).toBe("Today");
    expect(dayLabel("2026-11-26", today, "en", t)).toBe("Yesterday");
    expect(dayLabel("2026-11-27", today, "fr", fr)).toBe("Aujourd'hui");
    expect(dayLabel("2026-11-26", today, "fr", fr)).toBe("Hier");
  });

  it("names the weekday within the last 6 days", () => {
    expect(dayLabel("2026-11-24", today, "fr", fr)).toBe("mardi");
    expect(dayLabel("2026-11-21", today, "en", t)).toBe("Saturday");
  });

  it("writes the short date from 7 days ago, without this year", () => {
    expect(dayLabel("2026-11-18", today, "fr", fr)).toBe("mer. 18 nov.");
    expect(dayLabel("2026-11-20", today, "en", t)).toBe("Fri, Nov 20");
  });

  it("adds the year of another year", () => {
    expect(dayLabel("2025-12-31", "2026-01-10", "fr", fr)).toBe("mer. 31 déc. 2025");
    expect(dayLabel("2025-12-31", "2026-01-05", "fr", fr)).toBe("mercredi");
    expect(dayLabel("2025-12-31", "2026-01-01", "en", t)).toBe("Yesterday");
  });

  it("counts calendar days across a DST change", () => {
    // Europe moves its clocks on 25 Oct 2026.
    expect(dayLabel("2026-10-25", "2026-10-26", "en", t)).toBe("Yesterday");
  });

  it("falls back to the ISO day for a bad locale", () => {
    expect(dayLabel("2026-11-02", today, "not a locale!", t)).toBe("2026-11-02");
  });
});

describe("runFlags (newest first, one day)", () => {
  const msgs = (...authors: string[]) => authors.map((authorId) => ({ authorId }));

  it("puts the avatar and the tail on a run's last (newest), the name on its first", () => {
    // Oldest to newest: A, A, A, B, A — newest first below.
    expect(runFlags(msgs("a", "b", "a", "a", "a"))).toEqual([
      { first: true, last: true }, // the lone newest A
      { first: true, last: true }, // B between two runs of A
      { first: false, last: true }, // the newest of the run of three: avatar, tail
      { first: false, last: false }, // the middle: neither
      { first: true, last: false }, // the oldest: the name
    ]);
  });

  it("makes a lone message both first and last", () => {
    expect(runFlags(msgs("a"))).toEqual([{ first: true, last: true }]);
    expect(runFlags([])).toEqual([]);
  });
});

describe("replyPreview (under 'Replying to …')", () => {
  it("keeps the first line only", () => {
    expect(replyPreview({ body: "  first line \nsecond\nthird", imagePath: null }, t)).toBe(
      "first line",
    );
  });

  it("says Photo for a photo alone, and keeps the text of a captioned one", () => {
    expect(replyPreview({ body: null, imagePath: "c/u/x.jpg" }, t)).toBe("🖼️ Photo");
    expect(replyPreview({ body: "  ", imagePath: "c/u/x.jpg" }, t)).toBe("🖼️ Photo");
    expect(replyPreview({ body: null, imagePath: "c/u/x.jpg" }, makeT("fr"))).toBe("🖼️ Photo");
    expect(replyPreview({ body: "look", imagePath: "c/u/x.jpg" }, t)).toBe("look");
  });

  it("has no line for an attachment alone", () => {
    expect(replyPreview({ body: null, imagePath: null }, t)).toBeNull();
  });
});

describe("swipe to reply", () => {
  it("follows the finger rightwards only, at half speed, capped", () => {
    expect(swipeOffset(-40)).toBe(0);
    expect(swipeOffset(20)).toBe(10);
    expect(swipeOffset(1000)).toBe(SWIPE_MAX);
  });

  it("replies from the threshold on", () => {
    expect(swipeTriggered(SWIPE_REPLY_AT - 1)).toBe(false);
    expect(swipeTriggered(SWIPE_REPLY_AT)).toBe(true);
  });

  it("shows the reply icon fully when it arms, before the bubble's maximum", () => {
    expect(SWIPE_ARMED_OFFSET).toBe(swipeOffset(SWIPE_REPLY_AT));
    expect(SWIPE_ARMED_OFFSET).toBeLessThanOrEqual(SWIPE_MAX);
  });

  it("leaves touches at the left edge to the back swipe", () => {
    expect(startsAtEdge(0)).toBe(true);
    expect(startsAtEdge(SWIPE_EDGE - 1)).toBe(true);
    expect(startsAtEdge(SWIPE_EDGE)).toBe(false);
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
  const group = (isMember: boolean, removed = false) => ({ isMember, removed }) as Group;

  it("shows the removed state on not_a_member", () => {
    expect(closedReason(group(true), "not_a_member")).toBe("removed");
    expect(closedReason(group(true), "removed_from_group")).toBe("removed");
  });

  it("no line for a reader who isn't a member without a removal (left, readmitted): Join", () => {
    expect(closedReason(group(false), null)).toBeNull();
  });

  it("shows the removed state to a removed member, opened as a member or a preview", () => {
    expect(closedReason(group(false, true), null)).toBe("removed");
  });

  it("shows the deleted state for a gone group", () => {
    expect(closedReason(null, null)).toBe("groupDeleted");
    expect(closedReason(group(true), "not_found")).toBe("groupDeleted");
  });

  it("stays open otherwise (and while the group loads)", () => {
    expect(closedReason(group(true), null)).toBeNull();
    expect(closedReason(undefined, "rate_limited")).toBeNull();
  });
});

describe("sendErrorKey", () => {
  it("maps the send errors to their copy", () => {
    expect(sendErrorKey("message_too_long")).toBe("chat.error.tooLong");
    expect(sendErrorKey("rate_limited")).toBe("chat.error.rateLimited");
    expect(sendErrorKey("too_many_requests")).toBe("dms.error.tooManyRequests");
    expect(sendErrorKey("unknown")).toBe("chat.error.generic");
  });
});

describe("shownInList", () => {
  it("leaves out a DM nothing was written in yet, never a group", () => {
    expect(shownInList({ kind: "dm", lastMessage: null })).toBe(false);
    expect(shownInList({ kind: "dm", lastMessage: { id: "m" } })).toBe(true);
    expect(shownInList({ kind: "group", lastMessage: null })).toBe(true);
  });
});

describe("canDeleteMessage (the menu's Delete entry)", () => {
  const rule = (over: Partial<Parameters<typeof canDeleteMessage>[0]>) =>
    canDeleteMessage({ own: false, meAdmin: false, creator: false, authorAdmin: false, ...over });

  it("offers my own message, and any as an app admin", () => {
    expect(rule({ own: true })).toBe(true);
    expect(rule({ meAdmin: true, authorAdmin: true })).toBe(true);
  });

  it("offers the creator others' messages, never an app admin's", () => {
    expect(rule({ creator: true })).toBe(true);
    expect(rule({ creator: true, authorAdmin: true })).toBe(false);
  });

  it("offers nothing to a plain member on others", () => {
    expect(rule({})).toBe(false);
  });
});

describe("screenErrorCode", () => {
  it("lets only a send or a join close the screen", () => {
    expect(closedReason(undefined, screenErrorCode("send", "not_a_member"), true)).toBe("removed");
    expect(closedReason(undefined, screenErrorCode("join", "not_found"), false)).toBe(
      "groupDeleted",
    );
    for (const action of ["edit", "delete", "like", "translate", "notify"] as const) {
      expect(closedReason(undefined, screenErrorCode(action, "not_a_member"), true)).toBeNull();
      expect(closedReason(undefined, screenErrorCode(action, "not_found"), true)).toBeNull();
    }
  });
});

describe("hitsControl (taps a double tap leaves to the bubble's controls)", () => {
  const pill = { x: 10, y: 50, width: 30, height: 16 };
  const quote = { x: 8, y: 6, width: 120, height: 40 };

  it("hits a control, with the slop around it", () => {
    expect(hitsControl(20, 55, [pill, null, null], 6)).toBe(true);
    expect(hitsControl(45, 70, [pill, null, null], 6)).toBe(true);
    expect(hitsControl(50, 20, [pill, quote], 0)).toBe(true);
  });

  it("misses elsewhere, and with no controls shown", () => {
    expect(hitsControl(200, 55, [pill, quote], 6)).toBe(false);
    expect(hitsControl(20, 55, [null, null, null], 6)).toBe(false);
  });
});

describe("msUntilNextDay", () => {
  it("waits until just past the next local midnight", () => {
    const now = new Date(2026, 10, 27, 23, 59, 0);
    expect(msUntilNextDay(now)).toBe(61_000);
  });

  it("counts calendar days across a DST change, not 24 h", () => {
    const now = new Date(2026, 9, 24, 12);
    const at = new Date(now.getTime() + msUntilNextDay(now) - 1000);
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([25, 0, 0]);
  });
});
