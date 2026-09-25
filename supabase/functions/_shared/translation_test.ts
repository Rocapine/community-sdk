import { assertEquals } from "jsr:@std/assert@1";
import {
  hasFreshAttempt,
  IN_FLIGHT_MS,
  isInFlight,
  languageOf,
  missingLocales,
  parseTranslationResponse,
  resolveTargetLocale,
  runPool,
  type TranslationRow,
  waitFor,
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

Deno.test("missingLocales: a fresh attempt marker is not a presence and carries no source", () => {
  const attempt: TranslationRow = {
    locale: "attempt",
    source_locale: "",
    content: "",
    created_at: new Date().toISOString(),
  };
  assertEquals(missingLocales([attempt], ["en", "fr"]), ["en", "fr"]);
  const withReal: TranslationRow[] = [
    attempt,
    { locale: "fr", source_locale: "en", content: "Bonjour" },
  ];
  assertEquals(missingLocales(withReal, ["en", "en-GB", "fr", "pl"]), ["pl"]);
});

Deno.test("hasFreshAttempt: an attempt younger than maxAge is fresh", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const have: TranslationRow[] = [
    { locale: "attempt", source_locale: "", content: "", created_at: "2026-09-24T07:00:00Z" },
  ];
  assertEquals(hasFreshAttempt(have, now, 6 * 3600_000), true);
});

Deno.test("hasFreshAttempt: an attempt older than maxAge (or none) is not fresh", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const stale: TranslationRow[] = [
    { locale: "attempt", source_locale: "", content: "", created_at: "2026-09-24T05:59:59Z" },
    { locale: "fr", source_locale: "en", content: "x", created_at: "2026-09-24T11:59:00Z" },
  ];
  assertEquals(hasFreshAttempt(stale, now, 6 * 3600_000), false);
  assertEquals(hasFreshAttempt([], now, 6 * 3600_000), false);
});

Deno.test("parseTranslationResponse normalises a regional source_locale to its language", () => {
  const parsed = parseTranslationResponse(
    { source_locale: "pt-BR", translations: { en: { content: "Hi", options: [] } } },
    TARGETS,
    0,
  );
  assertEquals(parsed?.sourceLocale, "pt");
  assertEquals(Object.keys(parsed!.translations), ["en"]);
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

/** A fake clock whose sleep advances time instantly; counts sleeps. */
function fakeClock() {
  const clock = { t: 0, sleeps: 0 };
  return {
    clock,
    now: () => clock.t,
    sleep: (ms: number) => {
      clock.t += ms;
      clock.sleeps++;
      return Promise.resolve();
    },
  };
}

Deno.test("waitFor: resolves on the first done read without sleeping", async () => {
  const { clock, now, sleep } = fakeClock();
  const value = await waitFor(() => Promise.resolve({ done: true, value: "a" }), {
    timeoutMs: 10_000,
    intervalMs: 1500,
    sleep,
    now,
  });
  assertEquals(value, "a");
  assertEquals(clock.sleeps, 0);
});

Deno.test("waitFor: retries until done", async () => {
  const { clock, now, sleep } = fakeClock();
  let reads = 0;
  const value = await waitFor(
    () => {
      reads++;
      return Promise.resolve({ done: reads === 3, value: reads });
    },
    { timeoutMs: 10_000, intervalMs: 1500, sleep, now },
  );
  assertEquals(value, 3);
  assertEquals(clock.sleeps, 2);
});

Deno.test("waitFor: returns the last value at the timeout", async () => {
  const { clock, now, sleep } = fakeClock();
  let reads = 0;
  const value = await waitFor(
    () => {
      reads++;
      return Promise.resolve({ done: false, value: reads });
    },
    { timeoutMs: 20_000, intervalMs: 1500, sleep, now },
  );
  // Reads at t = 0, 1500, …, 19500 (14 reads), then one last read at 20000 after the final sleep.
  assertEquals(value, reads);
  assertEquals(clock.t, 20_000);
  assertEquals(reads, 15);
});

Deno.test("isInFlight: only an attempt younger than IN_FLIGHT_MS counts", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const attemptAgo = (ms: number): TranslationRow => ({
    locale: "attempt",
    source_locale: "",
    content: "",
    created_at: new Date(now - ms).toISOString(),
  });
  assertEquals(isInFlight([attemptAgo(10_000)], now, IN_FLIGHT_MS), true);
  assertEquals(isInFlight([attemptAgo(5 * 60_000)], now, IN_FLIGHT_MS), false);
  assertEquals(
    isInFlight([{ locale: "en", source_locale: "pl", content: "Hi" }], now, IN_FLIGHT_MS),
    false,
  );
  assertEquals(isInFlight([], now, IN_FLIGHT_MS), false);
});
