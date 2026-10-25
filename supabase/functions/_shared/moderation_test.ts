import { assertEquals } from "jsr:@std/assert@1";

// SCORE_HIDE is computed at module load from env, so set it before importing.
Deno.env.set("MODERATION_EXCLUDED_CATEGORIES", "sexual");
const { flaggedCategories, moderationParts } = await import("./moderation.ts");

const sexual = { categories: { sexual: false }, category_scores: { sexual: 0.6 } };

Deno.test("sexual score 0.6 applied to text only, excluded => not flagged", () => {
  assertEquals(
    flaggedCategories({ ...sexual, category_applied_input_types: { sexual: ["text"] } }),
    [],
  );
});

Deno.test("sexual score 0.6 applied to image => flagged", () => {
  assertEquals(
    flaggedCategories({ ...sexual, category_applied_input_types: { sexual: ["text", "image"] } }),
    ["sexual"],
  );
});

Deno.test("moderationParts", () => {
  assertEquals(moderationParts("hi", null), "hi");
  assertEquals(moderationParts("", "https://x/a.jpg"), [
    { type: "image_url", image_url: { url: "https://x/a.jpg" } },
  ]);
  const both = moderationParts("hi", "https://x/a.jpg");
  assertEquals(both.length, 2);
  assertEquals((both as { type: string }[])[0].type, "text");
});
