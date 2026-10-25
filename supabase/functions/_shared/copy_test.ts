import { assertEquals } from "jsr:@std/assert@1";
import { excerptOrPhoto, pluralCategory, pushCopy } from "./copy.ts";

// Mirrors packages/ui/src/__tests__/i18n.test.ts — the two rule sets must agree.
Deno.test("pluralCategory: pl / uk / ro edge values", () => {
  assertEquals(pluralCategory("pl", 14), "many");
  assertEquals(pluralCategory("pl", 24), "few");
  assertEquals(pluralCategory("uk", 21), "one");
  assertEquals(pluralCategory("uk", 11), "other");
  assertEquals(pluralCategory("uk", 23), "few");
  assertEquals(pluralCategory("ro", 0), "few");
  assertEquals(pluralCategory("ro", 19), "few");
  assertEquals(pluralCategory("ro", 20), "other");
  assertEquals(pluralCategory("ro", 102), "few");
  assertEquals(pluralCategory("fr", 0), "one");
  assertEquals(pluralCategory("ko", 2), "other");
});

Deno.test("pushCopy: built-in photo label, localized", () => {
  assertEquals(pushCopy("fr").text("photo"), "📷 Photo");
  assertEquals(pushCopy("de").text("photo"), "📷 Foto");
  assertEquals(pushCopy("pl").text("photo"), "📷 Zdjęcie");
  assertEquals(pushCopy("es-419").text("photo"), "📷 Foto");
  assertEquals(pushCopy(null).text("photo"), "📷 Photo");
});

Deno.test("excerptOrPhoto: photo for blank content, 140-char truncation otherwise", () => {
  assertEquals(excerptOrPhoto("", "📷 Photo"), "📷 Photo");
  assertEquals(excerptOrPhoto("  \n ", "📷 Photo"), "📷 Photo");
  assertEquals(excerptOrPhoto("hello", "x"), "hello");
  const long = excerptOrPhoto("a".repeat(200), "x");
  assertEquals(long.length, 140);
  assertEquals(long.endsWith("..."), true);
});
