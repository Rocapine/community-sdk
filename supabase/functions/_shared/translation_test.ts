import { assertEquals } from "jsr:@std/assert@1";
import { hasTranslatableContent, targetChunks, translationStyleLines } from "./translation.ts";

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
