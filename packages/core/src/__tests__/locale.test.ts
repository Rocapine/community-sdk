import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import { languageOf, readerLocale } from "../locale";

const base = {
  supabase: null,
  appName: "t",
  anonymousAuthorFallback: "Someone",
  topics: [],
  modules: { polls: false, push: false, inbox: false, reaction: false as const },
};

describe("readerLocale", () => {
  const locales = ["en", "es-ES", "es-419", "pt-PT", "pl"];
  const cfgFor = (locale: string, translation: { locales: string[] } | false = { locales }) =>
    resolveConfig({
      ...base,
      modules: { ...base.modules, translation },
      host: { getLocale: () => locale },
    });

  it("returns null when the module declares no locales", () => {
    expect(readerLocale(cfgFor("en", { locales: [] }))).toBeNull();
  });
  it("returns null when the module is off", () => {
    expect(readerLocale(cfgFor("es-419", false))).toBeNull();
    expect(readerLocale(resolveConfig({ ...base, host: { getLocale: () => "en" } }))).toBeNull();
  });
  it("matches exactly, then by language, else null", () => {
    expect(readerLocale(cfgFor("es-419"))).toBe("es-419");
    expect(readerLocale(cfgFor("es-MX"))).toBe("es-ES");
    expect(readerLocale(cfgFor("pt-BR"))).toBe("pt-PT");
    expect(readerLocale(cfgFor("fr"))).toBeNull();
  });
  it("languageOf strips the region", () => {
    expect(languageOf("pt-BR")).toBe("pt");
  });
});
