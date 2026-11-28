import { describe, expect, it } from "vitest";
import { makeT } from "../i18n";
import { en } from "../locales/en";
import { cs } from "../locales/cs";
import { da } from "../locales/da";
import { de } from "../locales/de";
import { el } from "../locales/el";
import { es419 } from "../locales/es-419";
import { esES } from "../locales/es-ES";
import { fr } from "../locales/fr";
import { frVous } from "../locales/fr-vous";
import { hr } from "../locales/hr";
import { hu } from "../locales/hu";
import { it as itLocale } from "../locales/it";
import { ko } from "../locales/ko";
import { nb } from "../locales/nb";
import { nl } from "../locales/nl";
import { pl } from "../locales/pl";
import { ptBR } from "../locales/pt-BR";
import { ptPT } from "../locales/pt-PT";
import { ro } from "../locales/ro";
import { ru } from "../locales/ru";
import { sk } from "../locales/sk";
import { sv } from "../locales/sv";
import { uk } from "../locales/uk";
import {
  dmClosedReason,
  hubView,
  isRequestMode,
  seenMessageId,
  senderContext,
  showRequestsRow,
} from "../utils/chat";
import { lastMessagePreview } from "../utils/groups";

const t = makeT("en");

describe("isRequestMode", () => {
  it("is on while my side is a request, from the list or my pending requests", () => {
    expect(isRequestMode("request", false, false)).toBe(true);
    // The list only holds active conversations: a request comes from useDmRequests.
    expect(isRequestMode(undefined, true, false)).toBe(true);
  });
  it("is off for an active DM, a group, or once I accepted here", () => {
    expect(isRequestMode("active", false, false)).toBe(false);
    expect(isRequestMode("active", true, false)).toBe(false);
    expect(isRequestMode(null, false, false)).toBe(false);
    expect(isRequestMode(undefined, true, true)).toBe(false);
  });
});

describe("seenMessageId", () => {
  // Newest first, like a page of messages.
  const msgs = [
    { id: "3", authorId: "peer", createdAt: "2026-11-28T10:03:00.000000+00:00" },
    { id: "2", authorId: "me", createdAt: "2026-11-28T10:02:00.000000+00:00" },
    { id: "1", authorId: "me", createdAt: "2026-11-28T10:01:00.000000+00:00" },
  ];
  it("goes under my newest message once the peer read it", () => {
    expect(seenMessageId(msgs, "me", "2026-11-28T10:02:30+00:00")).toBe("2");
    expect(seenMessageId(msgs, "me", "2026-11-28T10:02:00.000000+00:00")).toBe("2");
  });
  it("never under an older message of mine, even read", () => {
    expect(seenMessageId(msgs, "me", "2026-11-28T10:01:30+00:00")).toBeNull();
  });
  it("is null without a read, or with no message of mine", () => {
    expect(seenMessageId(msgs, "me", null)).toBeNull();
    expect(seenMessageId(msgs.slice(0, 1), "me", "2026-11-28T11:00:00+00:00")).toBeNull();
    expect(seenMessageId(msgs, null, "2026-11-28T11:00:00+00:00")).toBeNull();
  });
});

describe("showRequestsRow", () => {
  it("is hidden at 0", () => {
    expect(showRequestsRow(0)).toBe(false);
    expect(showRequestsRow(2)).toBe(true);
  });
});

describe("senderContext", () => {
  const since = "2026-03-14T09:00:00+00:00";
  it("names up to 3 groups in common, then how many more", () => {
    expect(
      senderContext(
        { groupsInCommon: 2, commonGroupNames: ["Paris", "Lyon"], memberSince: since },
        "en",
        t,
      ),
    ).toBe("Paris, Lyon · Member since March 2026");
    expect(
      senderContext(
        { groupsInCommon: 5, commonGroupNames: ["A", "B", "C"], memberSince: since },
        "en",
        t,
      ),
    ).toBe("A, B, C +2 · Member since March 2026");
  });
  it("says when there is none, or counts unnamed ones", () => {
    expect(
      senderContext({ groupsInCommon: 0, commonGroupNames: [], memberSince: since }, "en", t),
    ).toBe("No groups in common · Member since March 2026");
    expect(
      senderContext({ groupsInCommon: 1, commonGroupNames: [], memberSince: since }, "en", t),
    ).toBe("1 group in common · Member since March 2026");
  });
  it("writes the month in the reader's locale", () => {
    expect(
      senderContext(
        { groupsInCommon: 0, commonGroupNames: [], memberSince: since },
        "fr",
        makeT("fr"),
      ),
    ).toContain("mars 2026");
  });
});

describe("dmClosedReason", () => {
  it("is blocked across a block (no peer in the list) or when a send says so", () => {
    expect(dmClosedReason({ peerId: null }, null)).toBe("blocked");
    expect(dmClosedReason({ peerId: "p" }, "blocked")).toBe("blocked");
    expect(dmClosedReason(undefined, "blocked")).toBe("blocked");
  });
  it("stays open otherwise (a request isn't in the list yet)", () => {
    expect(dmClosedReason({ peerId: "p" }, null)).toBeNull();
    expect(dmClosedReason(undefined, null)).toBeNull();
    expect(dmClosedReason({ peerId: "p" }, "rate_limited")).toBeNull();
  });
});

describe("hubView", () => {
  const base = { hubLayout: "tabs" as const, homeLayout: "header" as const };
  it("shows tabs, or the unified list, with both modules", () => {
    expect(hubView({ ...base, groups: true, dms: true })).toBe("tabs");
    expect(hubView({ ...base, hubLayout: "unified", groups: true, dms: true })).toBe("unified");
  });
  it("shows one half without tabs with only one module", () => {
    expect(hubView({ ...base, groups: true, dms: false })).toBe("groups");
    expect(hubView({ ...base, hubLayout: "unified", groups: true, dms: false })).toBe("groups");
    expect(hubView({ ...base, groups: false, dms: true })).toBe("dms");
    expect(hubView({ ...base, groups: false, dms: false })).toBeNull();
  });
  it("leaves groups to the home's Groups segment when dms is on", () => {
    expect(hubView({ ...base, homeLayout: "segmented", groups: true, dms: true })).toBe("dms");
    // Groups only: the page keeps its groups.
    expect(hubView({ ...base, homeLayout: "segmented", groups: true, dms: false })).toBe("groups");
  });
});

describe("lastMessagePreview in a DM", () => {
  it("drops the peer's name, keeps You for mine", () => {
    const msg = (authorId: string) => ({ id: "m", body: "hi", authorId });
    expect(lastMessagePreview(msg("peer"), "me", "Ana", t, true)).toBe("hi");
    expect(lastMessagePreview(msg("me"), "me", "Ana", t, true)).toBe("You: hi");
  });
});

describe("DM copy", () => {
  const keys = [
    "messages.tabs.conversations",
    "messages.requests",
    "dms.empty",
    "dms.requests.title",
    "dms.requests.pending.one",
    "dms.requests.pending.other",
    "dms.requests.hint",
    "dms.requests.empty",
    "dms.request.bar",
    "dms.request.accept",
    "dms.request.decline",
    "dms.request.block",
    "dms.context.noGroups",
    "dms.context.groups.one",
    "dms.context.groups.other",
    "dms.context.memberSince",
    "chat.blocked",
    "chat.seen",
  ];
  const catalogs = {
    en,
    cs,
    da,
    de,
    el,
    es419,
    esES,
    fr,
    frVous,
    hr,
    hu,
    itLocale,
    ko,
    nb,
    nl,
    pl,
    ptBR,
    ptPT,
    ro,
    ru,
    sk,
    sv,
    uk,
  };
  for (const [name, catalog] of Object.entries(catalogs)) {
    it(`${name} has every DM key, with its placeholders`, () => {
      for (const key of keys) {
        const value = (catalog as Record<string, string>)[key];
        expect(value, key).toBeTruthy();
        for (const p of en[key as keyof typeof en].match(/\{\w+\}/g) ?? [])
          expect(value, `${key} ${p}`).toContain(p);
      }
    });
  }
});
