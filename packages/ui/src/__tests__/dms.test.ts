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
  conversationIdentity,
  dmState,
  groupClosed,
  hubView,
  seenMessageId,
  senderContext,
  showRequestsRow,
} from "../utils/chat";
import { lastMessagePreview } from "../utils/groups";
import { canMessage } from "../utils/dms";

const t = makeT("en");

describe("conversationIdentity", () => {
  const base = {
    listed: undefined,
    request: undefined,
    sticky: null,
    dmsOn: true,
    groupsOn: true,
    preview: false,
    loaded: true,
  };
  const dm = { kind: "dm" as const, peerId: "p", requestState: "active" as const };
  it("reads a listed conversation, or a pending request as a DM", () => {
    expect(conversationIdentity({ ...base, listed: dm })).toEqual({
      kind: "dm",
      peerId: "p",
      confirmed: true,
    });
    expect(conversationIdentity({ ...base, request: { senderId: "s" } })).toEqual({
      kind: "dm",
      peerId: "s",
      confirmed: true,
    });
  });
  it("keeps a DM through the accept window (out of requests, not listed yet)", () => {
    const sticky = { kind: "dm" as const, peerId: "s" };
    expect(conversationIdentity({ ...base, sticky })).toEqual({ ...sticky, confirmed: true });
    // Decline back-animation too: never flips to a group.
    expect(conversationIdentity({ ...base, sticky, loaded: false }).kind).toBe("dm");
  });
  it("has no peer across a block, whatever it knew", () => {
    const blocked = { ...dm, peerId: null, requestState: null };
    expect(
      conversationIdentity({ ...base, listed: blocked, sticky: { kind: "dm", peerId: "p" } })
        .peerId,
    ).toBeNull();
  });
  it("is a group without dms, or in a preview, as before", () => {
    expect(conversationIdentity({ ...base, dmsOn: false, loaded: false }).kind).toBe("group");
    expect(conversationIdentity({ ...base, preview: true, loaded: false }).kind).toBe("group");
  });
  it("waits for both lists, then guesses unconfirmed", () => {
    expect(conversationIdentity({ ...base, loaded: false }).kind).toBeNull();
    expect(conversationIdentity(base)).toEqual({ kind: "group", peerId: null, confirmed: false });
    // Dms only.
    expect(conversationIdentity({ ...base, groupsOn: false }).kind).toBe("dm");
    expect(conversationIdentity({ ...base, groupsOn: false, loaded: false }).kind).toBeNull();
  });
});

describe("dmState", () => {
  const base = {
    listed: undefined,
    pending: false,
    accepted: false,
    left: false,
    loaded: true,
    errorCode: null,
  };
  const active = { peerId: "p", requestState: "active" as const };
  it("is a request while mine to answer", () => {
    expect(dmState({ ...base, pending: true })).toBe("request");
    expect(dmState({ ...base, listed: { peerId: "p", requestState: "request" } })).toBe("request");
  });
  it("goes live at once on accept, before the lists catch up", () => {
    expect(dmState({ ...base, pending: true, accepted: true })).toBe("active");
    expect(dmState({ ...base, accepted: true })).toBe("active");
    expect(dmState({ ...base, listed: active })).toBe("active");
  });
  it("stays left (closing) after a decline or a block here", () => {
    expect(dmState({ ...base, left: true })).toBe("left");
    expect(dmState({ ...base, pending: true, left: true })).toBe("left");
  });
  it("is blocked across a block, or when a send says so", () => {
    expect(dmState({ ...base, listed: { peerId: null, requestState: null } })).toBe("blocked");
    expect(dmState({ ...base, listed: active, errorCode: "blocked" })).toBe("blocked");
    expect(dmState({ ...base, listed: active, errorCode: "rate_limited" })).toBe("active");
  });
  it("is unavailable once gone from both lists (a request withdrawn, a stale link)", () => {
    expect(dmState(base)).toBe("unavailable");
    expect(dmState({ ...base, loaded: false })).toBe("loading");
  });
});

describe("groupClosed", () => {
  it("says unavailable for an unconfirmed id that is no group", () => {
    expect(groupClosed(null, null, false)).toBe("unavailable");
  });
  it("keeps the group lines otherwise", () => {
    expect(groupClosed(null, null, true)).toBe("groupDeleted");
    expect(groupClosed(undefined, null, false)).toBeNull();
    expect(groupClosed(undefined, "not_a_member", true)).toBe("removed");
  });
});

describe("seenMessageId", () => {
  const sending = (m: { id: string }) => m.id.startsWith("optimistic-");
  // Newest first, like a page of messages.
  const msgs = [
    { id: "3", authorId: "peer", createdAt: "2026-11-28T10:03:00.000000+00:00", status: "visible" },
    { id: "2", authorId: "me", createdAt: "2026-11-28T10:02:00.000000+00:00", status: "visible" },
    { id: "1", authorId: "me", createdAt: "2026-11-28T10:01:00.000000+00:00", status: "visible" },
  ];
  it("goes under my newest message once the peer read it", () => {
    expect(seenMessageId(msgs, "me", "2026-11-28T10:02:30+00:00", sending)).toBe("2");
    expect(seenMessageId(msgs, "me", "2026-11-28T10:02:00.000000+00:00", sending)).toBe("2");
  });
  it("never under an older message of mine, even read", () => {
    expect(seenMessageId(msgs, "me", "2026-11-28T10:01:30+00:00", sending)).toBeNull();
  });
  it("stays under the newest confirmed one while a send is in flight", () => {
    const withSend = [
      { id: "optimistic-1", authorId: "me", createdAt: "2026-11-28T10:05:00Z", status: "visible" },
      ...msgs,
    ];
    expect(seenMessageId(withSend, "me", "2026-11-28T10:04:00Z", sending)).toBe("2");
  });
  it("skips my deleted or hidden tombstones", () => {
    const tomb = [
      { id: "4", authorId: "me", createdAt: "2026-11-28T10:04:00Z", status: "deleted" },
      { id: "5", authorId: "me", createdAt: "2026-11-28T10:04:30Z", status: "hidden" },
    ].reverse();
    expect(seenMessageId([...tomb, ...msgs], "me", "2026-11-28T10:05:00Z", sending)).toBe("2");
  });
  it("is null without a read, or with no message of mine", () => {
    expect(seenMessageId(msgs, "me", null, sending)).toBeNull();
    expect(seenMessageId(msgs.slice(0, 1), "me", "2026-11-28T11:00:00+00:00", sending)).toBeNull();
    expect(seenMessageId(msgs, null, "2026-11-28T11:00:00+00:00", sending)).toBeNull();
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

describe("canMessage", () => {
  const base = {
    memberId: "m",
    me: "me",
    dms: { entryPoints: ["profile" as const, "contextMenu" as const] },
    entryPoint: "profile" as const,
    flag: true,
  };
  it("shows on someone else's profile I may message", () => {
    expect(canMessage(base)).toBe(true);
    expect(canMessage({ ...base, entryPoint: "contextMenu" })).toBe(true);
  });
  it.each([
    ["my own profile", { memberId: "me" }],
    ["identity unknown", { me: null }],
    ["dms off", { dms: null }],
    ["entry point off", { entryPoint: "newMessage" as const }],
    ["they refuse DMs, or have no account the app requires (flag false)", { flag: false }],
    ["a block either way", { blocked: true }],
  ])("hides on %s", (_label, change) => {
    expect(canMessage({ ...base, ...change })).toBe(false);
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
    "chat.unavailable",
    "dms.blockedMember",
    "dms.request.error",
    "dms.message",
    "dms.new.title",
    "dms.new.search",
    "dms.new.empty",
    "dms.error.tooManyRequests",
    "profile.receiveDms",
    "profile.receiveDmsHelper",
    "inbox.dmAccepted",
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
