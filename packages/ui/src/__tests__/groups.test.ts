import { describe, expect, it } from "vitest";
import { makeT } from "../i18n";
import { en } from "../locales/en";
import { esES } from "../locales/es-ES";
import { es419 } from "../locales/es-419";
import { fr } from "../locales/fr";
import { frVous } from "../locales/fr-vous";
import { de } from "../locales/de";
import { it as itLocale } from "../locales/it";
import { pl } from "../locales/pl";
import { ptPT } from "../locales/pt-PT";
import { ptBR } from "../locales/pt-BR";
import { ko } from "../locales/ko";
import { ro } from "../locales/ro";
import { uk } from "../locales/uk";
import { nl } from "../locales/nl";
import { ru } from "../locales/ru";
import { el } from "../locales/el";
import { hu } from "../locales/hu";
import { sv } from "../locales/sv";
import { nb } from "../locales/nb";
import { da } from "../locales/da";
import { hr } from "../locales/hr";
import { sk } from "../locales/sk";
import { cs } from "../locales/cs";
import {
  canManage,
  exploreRowAction,
  exploreRowTap,
  groupErrorKey,
  guardedJoin,
  joinGate,
  lastMessagePreview,
  needsAccount,
  onlineLabel,
} from "../utils/groups";

import { homeSegment, rememberHomeSegment } from "../utils/homeSegment";

const t = makeT("en");

describe("onlineLabel", () => {
  it("is null at 0: presence is shown, absence never", () => {
    expect(onlineLabel(0, t)).toBeNull();
  });
  it("counts the members online", () => {
    expect(onlineLabel(1, t)).toBe("1 online");
    expect(onlineLabel(17, t)).toBe("17 online");
  });
});

describe("exploreRowAction", () => {
  it("opens a group I belong to, joins one I don't", () => {
    expect(exploreRowAction({ isMember: true })).toBe("open");
    expect(exploreRowAction({ isMember: false })).toBe("join");
  });
});

describe("exploreRowTap", () => {
  it("opens my group, previews another, or joins it when previews are off", () => {
    expect(exploreRowTap({ isMember: true }, "none")).toBe("open");
    expect(exploreRowTap({ isMember: false }, "readOnly")).toBe("preview");
    expect(exploreRowTap({ isMember: false }, "none")).toBe("join");
  });
});

describe("canManage", () => {
  it("is the active creator or an app admin, as can_manage_group", () => {
    expect(canManage({ myRole: "creator" }, false)).toBe(true);
    expect(canManage({ myRole: "member" }, true)).toBe(true);
    expect(canManage({ myRole: "member" }, false)).toBe(false);
    // The creator who left (or was replaced) no longer manages it.
    expect(canManage({ myRole: null }, false)).toBe(false);
  });
});

describe("needsAccount", () => {
  it("asks the host only when the rule is on and no account is linked", () => {
    expect(needsAccount(true, false)).toBe(true);
    expect(needsAccount(true, true)).toBe(false);
    expect(needsAccount(true, null)).toBe(false);
    expect(needsAccount(false, false)).toBe(false);
  });
});

describe("groupErrorKey", () => {
  it("names the field or the limit that failed, generic otherwise", () => {
    expect(groupErrorKey("name_required")).toBe("groups.error.nameRequired");
    expect(groupErrorKey("description_too_long")).toBe("groups.error.descriptionTooLong");
    expect(groupErrorKey("too_many_groups")).toBe("groups.error.tooManyGroups");
    expect(groupErrorKey("too_many_joined")).toBe("groups.error.tooManyJoined");
    expect(groupErrorKey("group_full")).toBe("groups.error.groupFull");
    expect(groupErrorKey("removed_from_group")).toBe("groups.error.removed");
    expect(groupErrorKey("banned")).toBe("groups.error.banned");
    expect(groupErrorKey("rate_limited")).toBe("groups.error.editLimit");
    expect(groupErrorKey("unknown")).toBe("groups.error.generic");
  });
});

describe("lastMessagePreview", () => {
  const msg = (body: string | null, authorId = "a") => ({ id: "m", body, authorId });
  it("prefixes the author, or You for mine", () => {
    expect(lastMessagePreview(msg("hi"), "me", "Ana", t)).toBe("Ana: hi");
    expect(lastMessagePreview(msg("hi", "me"), "me", "Ana", t)).toBe("You: hi");
  });
  it("shows a photo for an image-only message, and nothing before the first one", () => {
    expect(lastMessagePreview(msg(null), "me", "Ana", t)).toBe("Ana: 📷 Photo");
    expect(lastMessagePreview(null, "me", null, t)).toBe("No messages yet");
  });
  it("keeps one line", () => {
    expect(lastMessagePreview(msg("a\nb"), "me", "Ana", t)).toBe("Ana: a b");
  });
});

describe("joinGate", () => {
  const own = async () => true;
  const compose = async () => true;
  it("takes the screen's beforeJoinGroup first", () => {
    expect(joinGate(own, "feed", compose)).toBe(own);
    expect(joinGate(own, true, compose)).toBe(own);
  });
  it('falls back to the feed\'s beforeCompose only with requireAccount "feed"', () => {
    expect(joinGate(undefined, "feed", compose)).toBe(compose);
    expect(joinGate(undefined, true, compose)).toBeUndefined();
    expect(joinGate(undefined, false, compose)).toBeUndefined();
  });
});

describe("guardedJoin", () => {
  const run = (o: { accountMissing?: boolean; gate?: () => Promise<boolean> }) => {
    const calls: string[] = [];
    const result = guardedJoin({
      accountMissing: o.accountMissing ?? false,
      onAccountRequired: () => calls.push("account"),
      gate: o.gate
        ? async () => {
            calls.push("gate");
            return o.gate!();
          }
        : undefined,
      join: () => calls.push("join"),
    });
    return result.then((r) => ({ r, calls }));
  };

  it("asks for an account first, without running the gate", async () => {
    expect(await run({ accountMissing: true, gate: async () => true })).toEqual({
      r: "account",
      calls: ["account"],
    });
  });

  it("runs the gate, then joins", async () => {
    expect(await run({ gate: async () => true })).toEqual({ r: "joined", calls: ["gate", "join"] });
    expect(await run({})).toEqual({ r: "joined", calls: ["join"] });
  });

  it("stops on a gate that says no or throws", async () => {
    expect(await run({ gate: async () => false })).toEqual({ r: "refused", calls: ["gate"] });
    expect(
      await run({
        gate: async () => {
          throw new Error("x");
        },
      }),
    ).toEqual({ r: "refused", calls: ["gate"] });
  });
});

describe("homeSegment", () => {
  it("is the feed until another segment is chosen, then kept for the session", () => {
    expect(homeSegment()).toBe("feed");
    rememberHomeSegment("groups");
    expect(homeSegment()).toBe("groups");
    rememberHomeSegment("feed");
    expect(homeSegment()).toBe("feed");
  });
});

const KEYS = [
  "messages.title",
  "messages.exploreGroups",
  "messages.empty",
  "messages.you",
  "messages.author",
  "messages.noMessages",
  "messages.unread.one",
  "messages.unread.other",
  "groups.underReview",
  "groups.open",
  "groups.explore.title",
  "groups.explore.search",
  "groups.explore.recent",
  "groups.explore.empty",
  "groups.explore.create",
  "groups.form.createTitle",
  "groups.form.editTitle",
  "groups.form.create",
  "groups.form.addImage",
  "groups.form.changeImage",
  "groups.form.name",
  "groups.form.namePlaceholder",
  "groups.form.description",
  "groups.form.descriptionPlaceholder",
  "groups.form.publicNote",
  "groups.error.nameRequired",
  "groups.error.descriptionRequired",
  "groups.error.nameTooLong",
  "groups.error.descriptionTooLong",
  "groups.error.tooManyGroups",
  "groups.error.tooManyJoined",
  "groups.error.groupFull",
  "groups.error.generic",
  "groups.error.removed",
  "groups.error.banned",
  "groups.review.hidden",
  "groups.details.delete",
  "groups.details.deleteConfirm",
  "groups.members.removed",
  "groups.review.pending",
  "groups.review.rejected.name",
  "groups.review.rejected.description",
  "groups.review.rejected.image",
  "groups.details.title",
  "groups.details.members",
  "groups.details.share",
  "groups.details.edit",
  "groups.details.report",
  "groups.details.leave",
  "groups.details.leaveConfirm",
  "groups.members.title",
  "groups.members.search",
  "groups.members.creator",
  "groups.members.remove",
  "groups.members.removeConfirm",
  "groups.members.readmit",
  "groups.members.empty",
  "groups.home.feed",
  "groups.home.groups",
  "groups.home.mine",
  "groups.home.discover",
  "groups.home.seeAll",
  "groups.card.join",
  "groups.card.gone",
];

describe("groups copy", () => {
  const catalogs = {
    en,
    "es-ES": esES,
    "es-419": es419,
    fr,
    "fr-vous": frVous,
    de,
    it: itLocale,
    pl,
    "pt-PT": ptPT,
    "pt-BR": ptBR,
    ko,
    ro,
    uk,
    nl,
    ru,
    el,
    hu,
    sv,
    nb,
    da,
    hr,
    sk,
    cs,
  };
  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} has every groups key`, () => {
      for (const key of KEYS) expect(catalog[key], `${locale} ${key}`).toBeTruthy();
    });
  }

  it("never promises approval while a group is under review or hidden", () => {
    for (const key of ["groups.review.pending", "groups.review.hidden"])
      expect(en[key]).not.toMatch(/once|when|approved|will appear/i);
  });
});
