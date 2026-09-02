import { describe, expect, it } from "vitest";
import { makeT } from "../i18n";
import { en } from "../locales/en";
import { esES } from "../locales/es-ES";
import { es419 } from "../locales/es-419";
import { fr } from "../locales/fr";
import { de } from "../locales/de";
import { it as itLocale } from "../locales/it";
import { pl } from "../locales/pl";
import { ptPT } from "../locales/pt-PT";
import { ptBR } from "../locales/pt-BR";

describe("makeT", () => {
  it("resolves a key from the en catalog", () => {
    const t = makeT("en");
    expect(t("rules.accept")).toBe("I agree, take me in");
  });

  it("override wins over the catalog", () => {
    const t = makeT("en", { "rules.accept": "Yes, I'm in" });
    expect(t("rules.accept")).toBe("Yes, I'm in");
  });

  it("falls back to en for an unknown locale", () => {
    const t = makeT("ja");
    expect(t("rules.accept")).toBe("I agree, take me in");
  });

  it("resolves the fr catalog", () => {
    const t = makeT("fr");
    expect(t("rules.accept")).toBe(fr["rules.accept"]);
  });

  it("resolves the de catalog", () => {
    const t = makeT("de");
    expect(t("rules.accept")).toBe(de["rules.accept"]);
  });

  it("returns the key itself when missing everywhere", () => {
    const t = makeT("en");
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("interpolates {param} placeholders", () => {
    const t = makeT("en");
    expect(t("menu.blockUser", { name: "Alex" })).toBe("Block Alex");
  });

  it("picks .one at count 1 and .other at 0 and 2", () => {
    const t = makeT("en");
    expect(t("poll.votes", { count: 1 })).toBe("1 vote");
    expect(t("poll.votes", { count: 0 })).toBe("0 votes");
    expect(t("poll.votes", { count: 2 })).toBe("2 votes");
  });

  it("plural resolution still honors overrides", () => {
    const t = makeT("en", { "poll.votes.other": "{count} ballots" });
    expect(t("poll.votes", { count: 3 })).toBe("3 ballots");
  });

  it("resolves an unlisted es variant to the es-ES base catalog", () => {
    const t = makeT("es-MX");
    expect(t("rules.accept")).toBe(esES["rules.accept"]);
  });

  it("resolves an unlisted pt variant to the pt-PT base catalog", () => {
    const t = makeT("pt-AO");
    expect(t("rules.accept")).toBe(ptPT["rules.accept"]);
  });

  it("resolves a single-catalog language's regional variant to its bare catalog", () => {
    const t = makeT("it-CH");
    expect(t("rules.accept")).toBe(itLocale["rules.accept"]);
  });

  it("resolves fr-CA to the fr bare catalog", () => {
    const t = makeT("fr-CA");
    expect(t("rules.accept")).toBe(fr["rules.accept"]);
  });

  it("resolves de-AT to the de bare catalog", () => {
    const t = makeT("de-AT");
    expect(t("rules.accept")).toBe(de["rules.accept"]);
  });

  it("falls back to en for a locale whose base language has no catalog", () => {
    const t = makeT("ja-JP");
    expect(t("rules.accept")).toBe(en["rules.accept"]);
  });
});

describe("locale catalogs", () => {
  const catalogs: Record<string, Record<string, string>> = {
    en,
    "es-ES": esES,
    "es-419": es419,
    fr,
    de,
    it: itLocale,
    pl,
    "pt-PT": ptPT,
    "pt-BR": ptBR,
  };

  const enKeys = Object.keys(en).sort();

  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} has exactly the same key set as en`, () => {
      expect(Object.keys(catalog).sort()).toEqual(enKeys);
    });
  }
});
