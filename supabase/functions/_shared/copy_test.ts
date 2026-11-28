import { assertEquals } from "jsr:@std/assert@1";
import { excerptOrPhoto, groupMessageBody, pluralCategory, pushCopy } from "./copy.ts";

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

// The 23 locales packages/ui ships: each one gets its own push copy, not English.
const UI_LOCALES = [
  "en",
  "es-ES",
  "es-419",
  "fr",
  "fr-vous",
  "de",
  "it",
  "pl",
  "pt-PT",
  "pt-BR",
  "ko",
  "ro",
  "uk",
  "nl",
  "ru",
  "el",
  "hu",
  "sv",
  "nb",
  "da",
  "hr",
  "sk",
  "cs",
];

Deno.test("pushCopy: every UI locale has built-in copy", () => {
  for (const locale of UI_LOCALES) {
    const copy = pushCopy(locale);
    assertEquals(copy.locale, locale);
    if (locale !== "en") {
      assertEquals(
        copy.text("comment.title") !== pushCopy("en").text("comment.title"),
        true,
        locale,
      );
    }
  }
});

Deno.test("pushCopy: Slavic plurals and Norwegian", () => {
  assertEquals(pluralCategory("ru", 22), "few");
  assertEquals(pluralCategory("hr", 11), "other");
  assertEquals(pluralCategory("cs", 3), "few");
  assertEquals(pluralCategory("sk", 5), "other");
  assertEquals(
    pushCopy("ru").text("like.many", { name: "Иван", count: 3 }),
    "Иван и ещё 3 человека оценили твой пост",
  );
  assertEquals(
    pushCopy("cs").text("reaction.many", { name: "Petr", count: 5 }),
    "Petr a 5 dalších myslí na tebe",
  );
  assertEquals(pushCopy("no").locale, "nb");
  assertEquals(pushCopy("fr-vous").text("reaction.one", { name: "Paul" }), "Paul pense à vous");
});

Deno.test("pushCopy: group message copy, every UI locale", () => {
  assertEquals(
    pushCopy("fr").text("message.groupBody", { sender: "Jean" }),
    "Jean a envoyé un message",
  );
  assertEquals(pushCopy("en").text("message.neutral"), "You have a new message");
  for (const locale of UI_LOCALES) {
    const copy = pushCopy(locale);
    const body = copy.text("message.groupBody", { sender: "Jean" });
    assertEquals(body.includes("Jean"), true, locale);
    assertEquals(copy.text("message.neutral").length > 0, true, locale);
    if (locale !== "en" && locale !== "fr-vous") {
      assertEquals(
        body !== pushCopy("en").text("message.groupBody", { sender: "Jean" }),
        true,
        locale,
      );
      assertEquals(
        copy.text("message.neutral") !== pushCopy("en").text("message.neutral"),
        true,
        locale,
      );
    }
  }
});

Deno.test("pushCopy: DM copy, every UI locale", () => {
  assertEquals(
    pushCopy("fr").text("message.dmBody", { sender: "Jean" }),
    "Jean t'a envoyé un message",
  );
  assertEquals(
    pushCopy("fr-vous").text("message.dmBody", { sender: "Jean" }),
    "Jean vous a envoyé un message",
  );
  assertEquals(pushCopy("en").text("message.request"), "You have a new message request");
  const en = pushCopy("en");
  for (const locale of UI_LOCALES) {
    const copy = pushCopy(locale);
    const body = copy.text("message.dmBody", { sender: "Jean" });
    const request = copy.text("message.request");
    assertEquals(body.includes("Jean"), true, locale);
    assertEquals(request.length > 0 && !request.includes("{"), true, locale);
    if (locale !== "en") {
      assertEquals(body !== en.text("message.dmBody", { sender: "Jean" }), true, locale);
      assertEquals(request !== en.text("message.request"), true, locale);
    }
  }
  assertEquals(
    pushCopy("fr").text("message.request") !== pushCopy("fr-vous").text("message.request"),
    true,
  );
});

Deno.test("groupMessageBody: no text leaves with sender or none", () => {
  const fr = pushCopy("fr");
  assertEquals(groupMessageBody(fr, "full", "Jean", "Salut", false), "Jean: Salut");
  assertEquals(groupMessageBody(fr, "full", "Jean", null, true), "Jean: 📷 Photo");
  assertEquals(groupMessageBody(fr, "full", "Jean", null, false), "Jean a envoyé un message");
  assertEquals(groupMessageBody(fr, "sender", "Jean", "Secret", false), "Jean a envoyé un message");
  assertEquals(groupMessageBody(fr, "none", "Jean", "Secret", true), "Tu as un nouveau message");
  const long = groupMessageBody(fr, "full", "Jean", "a".repeat(300), false);
  assertEquals(long.length, 120);
  assertEquals(long.startsWith("Jean: aaa"), true);
});
