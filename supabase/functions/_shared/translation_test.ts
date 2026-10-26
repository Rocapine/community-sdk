import { assertEquals } from "jsr:@std/assert@1";
import { hasTranslatableContent, translationStyleLines } from "./translation.ts";

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
