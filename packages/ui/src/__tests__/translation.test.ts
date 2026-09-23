import { describe, expect, it } from "vitest";
import { makeT } from "../i18n";
import { displayText, translationLine } from "../utils/translation";

const item = { text: "Hello", translation: { text: "Hola", sourceLocale: "en" } };

describe("translation helpers", () => {
  it("shows the translation by default and the original when toggled", () => {
    expect(displayText(item, false)).toBe("Hola");
    expect(displayText(item, true)).toBe("Hello");
    expect(displayText({ text: "Hi", translation: null }, false)).toBe("Hi");
  });
  it("builds the toggle line with the source language name", () => {
    const t = makeT("es-ES");
    expect(translationLine(t, item, false)).toBe("Traducido del inglés · Ver original");
    expect(translationLine(t, item, true)).toBe("Original · Ver traducción");
    expect(translationLine(t, { text: "x", translation: null }, false)).toBeNull();
  });
  it("falls back to the raw code for an unknown language", () => {
    const t = makeT("en");
    expect(
      translationLine(t, { text: "x", translation: { text: "y", sourceLocale: "xx" } }, false),
    ).toBe("Translated from xx · See original");
  });
  it("shows no caption for an undetermined source language", () => {
    const t = makeT("en");
    const undItem = { text: "x", translation: { text: "y", sourceLocale: "und" } };
    expect(translationLine(t, undItem, false)).toBeNull();
    expect(translationLine(t, undItem, true)).toBeNull();
  });
  it("shows no caption when the translation is identical to the original", () => {
    const t = makeT("es-419");
    const same = {
      text: "curl test post",
      translation: { text: "curl test post", sourceLocale: "en" },
    };
    expect(translationLine(t, same, false)).toBeNull();
    expect(translationLine(t, same, true)).toBeNull();
    expect(displayText(same, false)).toBe("curl test post");
  });
  it("uses idiomatic Polish genitive, French and Italian phrasing", () => {
    expect(translationLine(makeT("pl"), item, false)).toBe(
      "Przetłumaczono z angielskiego · Zobacz oryginał",
    );
    expect(translationLine(makeT("fr"), item, false)).toBe(
      "Traduit de l'anglais · Voir l'original",
    );
    expect(translationLine(makeT("it"), item, false)).toBe(
      "Tradotto dall'inglese · Vedi originale",
    );
  });
});
