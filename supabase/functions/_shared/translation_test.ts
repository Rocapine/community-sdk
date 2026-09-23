import { assertEquals } from "jsr:@std/assert@1";
import { languageOf, parseTranslationResponse, resolveTargetLocale } from "./translation.ts";

const TARGETS = ["en", "es-ES", "es-419", "pt-PT", "pl"];

Deno.test("languageOf strips the region", () => {
  assertEquals(languageOf("es-419"), "es");
  assertEquals(languageOf("EN"), "en");
});

Deno.test("resolveTargetLocale: exact, same-language, none", () => {
  assertEquals(resolveTargetLocale("es-419", TARGETS), "es-419");
  assertEquals(resolveTargetLocale("es-MX", TARGETS), "es-ES");
  assertEquals(resolveTargetLocale("pt-BR", TARGETS), "pt-PT");
  assertEquals(resolveTargetLocale("fr", TARGETS), null);
  assertEquals(resolveTargetLocale(null, TARGETS), null);
});

Deno.test(
  "parseTranslationResponse keeps only targets in another language and drops bad shapes",
  () => {
    const parsed = parseTranslationResponse(
      {
        source_locale: "en",
        translations: {
          en: { content: "same language, must be dropped", options: [] },
          "es-ES": { content: "Hola", options: ["Sí", "No"] },
          "es-419": { content: "Hola", options: ["Sí", "No"] },
          "pt-PT": { content: "Olá", options: ["Sim"] }, // wrong option count → dropped
          fr: { content: "not a target", options: [] },
        },
      },
      TARGETS,
      2,
    );
    assertEquals(parsed?.sourceLocale, "en");
    assertEquals(Object.keys(parsed!.translations).sort(), ["es-419", "es-ES"]);
    assertEquals(parsed!.translations["es-ES"].options, ["Sí", "No"]);
  },
);

Deno.test("parseTranslationResponse rejects invalid payloads", () => {
  assertEquals(parseTranslationResponse(null, TARGETS, 0), null);
  assertEquals(parseTranslationResponse({ translations: {} }, TARGETS, 0), null);
  assertEquals(
    parseTranslationResponse({ source_locale: "english!", translations: {} }, TARGETS, 0),
    null,
  );
});
