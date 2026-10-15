import { assertEquals } from "jsr:@std/assert@1";
import { pluralCategory } from "./copy.ts";

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
