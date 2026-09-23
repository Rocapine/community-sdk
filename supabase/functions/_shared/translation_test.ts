import { assertEquals } from "jsr:@std/assert@1";
import {
  languageOf,
  missingLocales,
  parseTranslationResponse,
  resolveTargetLocale,
  runPool,
  type TranslationRow,
} from "./translation.ts";

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

Deno.test("missingLocales excludes present locales and same-language-as-source locales", () => {
  const have: TranslationRow[] = [{ locale: "es-ES", source_locale: "en", content: "Hola" }];
  assertEquals(missingLocales(have, ["en", "es-ES", "en-GB", "pt-PT"]), ["pt-PT"]);
});

Deno.test("missingLocales returns every target when nothing exists yet", () => {
  const targets = ["en", "es-ES", "pt-PT"];
  assertEquals(missingLocales([], targets), targets);
});

Deno.test("missingLocales ignores the source marker row but still uses its known source", () => {
  const have: TranslationRow[] = [{ locale: "source", source_locale: "en", content: "" }];
  assertEquals(missingLocales(have, ["en", "en-GB", "fr"]), ["fr"]);
});

Deno.test("runPool: results preserve item order regardless of completion order", async () => {
  const delays = [30, 10, 20, 0]; // item 0 finishes last, item 3 first
  const fn = (i: number) =>
    new Promise<string>((resolve) => setTimeout(() => resolve(`item-${i}`), delays[i]));
  const { results, processed } = await runPool([0, 1, 2, 3], 4, fn);
  assertEquals(processed, 4);
  assertEquals(results, ["item-0", "item-1", "item-2", "item-3"]);
});

Deno.test("runPool: never runs more than `concurrency` at once", async () => {
  let active = 0;
  let maxActive = 0;
  const fn = async (n: number) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return n * 2;
  };
  const { results, processed } = await runPool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, fn);
  assertEquals(processed, 10);
  assertEquals(results, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  assertEquals(maxActive, 3);
});

Deno.test("runPool: stops starting new items when shouldContinue returns false", async () => {
  let started = 0;
  let allow = true;
  const fn = async (n: number) => {
    started++;
    if (started === 2) allow = false;
    return n;
  };
  const { results, processed } = await runPool([1, 2, 3, 4, 5], 1, fn, () => allow);
  assertEquals(processed, 2);
  assertEquals(results, [1, 2]);
});
