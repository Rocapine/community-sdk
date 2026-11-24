import { assertEquals } from "jsr:@std/assert@1";
import {
  FILTERED,
  hasTranslatableContent,
  normalizeForTranslation,
  targetChunks,
  translateTargets,
  translationStyleLines,
} from "./translation.ts";

Deno.test("translationStyleLines: a plain sentence applies to every target", () => {
  assertEquals(translationStyleLines("warm and brotherly", ["fr", "de"]), [
    "App voice: warm and brotherly",
  ]);
});

Deno.test(
  "translationStyleLines: a JSON map gives one hint per matching target, base language fallback",
  () => {
    assertEquals(
      translationStyleLines('{"fr":"address the reader as vous","de":"use Sie"}', [
        "fr-CA",
        "de",
        "es",
      ]),
      ["App voice for fr-CA: address the reader as vous", "App voice for de: use Sie"],
    );
  },
);

Deno.test("translationStyleLines: empty or broken JSON degrades gracefully", () => {
  assertEquals(translationStyleLines("  ", ["fr"]), []);
  assertEquals(translationStyleLines("{not json", ["fr"]), ["App voice: {not json"]);
});

Deno.test(
  "hasTranslatableContent: an image-only item (empty content) has nothing to translate",
  () => {
    assertEquals(hasTranslatableContent(""), false);
    assertEquals(hasTranslatableContent("  \n"), false);
    assertEquals(hasTranslatableContent("bonjour"), true);
  },
);

Deno.test("targetChunks: a short text keeps every target in one call", () => {
  const targets = Array.from({ length: 19 }, (_, i) => `l${i}`);
  assertEquals(targetChunks(300, targets), [targets]);
});

Deno.test(
  "targetChunks: a long text splits the targets, each call within the output budget",
  () => {
    const targets = Array.from({ length: 19 }, (_, i) => `l${i}`);
    const chunks = targetChunks(2000, targets);
    assertEquals(
      chunks.map((c) => c.length),
      [6, 6, 6, 1],
    );
    assertEquals(chunks.flat(), targets);
    // Longer than the budget itself: one target per call, never zero.
    assertEquals(targetChunks(20_000, ["a", "b"]), [["a"], ["b"]]);
  },
);

Deno.test("normalizeForTranslation folds math-styled letters to plain text", () => {
  assertEquals(normalizeForTranslation("𝟔 𝐝𝐚𝐲𝐬, 𝚑𝚎𝚢 𝚖𝚊𝚗"), "6 days, hey man");
  assertEquals(normalizeForTranslation("Déjà vu 🙏"), "Déjà vu 🙏");
});

const ok = (targets: string[]) => ({
  sourceLocale: "en",
  translations: Object.fromEntries(targets.map((t) => [t, { content: t, options: [] }])),
});

Deno.test(
  "translateTargets: a filtered call is split per locale and keeps every translation",
  async () => {
    const calls: string[][] = [];
    let skTries = 0;
    const result = await translateTargets(
      { content: "x", options: [], targets: ["fr", "sk", "de"] },
      (i) => {
        calls.push(i.targets);
        if (i.targets.length > 1) return Promise.resolve(FILTERED);
        if (i.targets[0] === "sk" && skTries++ === 0) return Promise.resolve(FILTERED);
        return Promise.resolve(ok(i.targets));
      },
    );
    assertEquals(Object.keys(result!.translations).sort(), ["de", "fr", "sk"]);
    assertEquals(calls.length, 5); // the batch, three single locales, the sk retry
  },
);

Deno.test("translateTargets: a locale filtered twice fails the item", async () => {
  const result = await translateTargets({ content: "x", options: [], targets: ["fr", "sk"] }, (i) =>
    Promise.resolve(i.targets.includes("sk") ? FILTERED : ok(i.targets)),
  );
  assertEquals(result, null);
});
