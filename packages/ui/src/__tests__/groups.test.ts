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
  groupErrorKey,
  groupStats,
  lastMessagePreview,
  onlineLabel,
} from "../utils/groups";

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

describe("groupStats", () => {
  it("adds the online count only above 0", () => {
    expect(groupStats(128, 4, t)).toBe("128 members · 4 online");
    expect(groupStats(31, 0, t)).toBe("31 members");
    expect(groupStats(1, 0, t)).toBe("1 member");
  });
});

describe("exploreRowAction", () => {
  it("opens a group I belong to, joins one I don't", () => {
    expect(exploreRowAction({ isMember: true })).toBe("open");
    expect(exploreRowAction({ isMember: false })).toBe("join");
  });
});

describe("canManage", () => {
  it("is the creator or an app admin", () => {
    expect(canManage({ isCreator: true }, false)).toBe(true);
    expect(canManage({ isCreator: false }, true)).toBe(true);
    expect(canManage({ isCreator: false }, false)).toBe(false);
  });
});

describe("groupErrorKey", () => {
  it("names the field or the limit that failed, generic otherwise", () => {
    expect(groupErrorKey("name_required")).toBe("groups.error.nameRequired");
    expect(groupErrorKey("description_too_long")).toBe("groups.error.descriptionTooLong");
    expect(groupErrorKey("too_many_groups")).toBe("groups.error.tooManyGroups");
    expect(groupErrorKey("too_many_joined")).toBe("groups.error.tooManyJoined");
    expect(groupErrorKey("group_full")).toBe("groups.error.groupFull");
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

  it("never promises approval while a group is under review", () => {
    expect(en["groups.review.pending"]).not.toMatch(/once|when|approved/i);
  });
});
