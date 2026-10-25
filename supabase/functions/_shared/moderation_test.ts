import { assertEquals } from "jsr:@std/assert@1";

// SCORE_HIDE is computed at module load from env, so set it before importing.
Deno.env.set("MODERATION_EXCLUDED_CATEGORIES", "sexual");
const { flaggedCategories, moderateItem } = await import("./moderation.ts");

const sexual = { categories: { sexual: false }, category_scores: { sexual: 0.6 } };

Deno.test("sexual score 0.6 on text, excluded => not flagged", () => {
  assertEquals(flaggedCategories(sexual), []);
});

Deno.test("sexual score 0.6 strict (image) => flagged despite the exclusion", () => {
  assertEquals(flaggedCategories(sexual, true), ["sexual"]);
});

// Stubs fetch with one canned moderation result per call.
// An entry is the flagged booleans, or a full result (to stub scores).
type Canned = Record<string, boolean> | { categories: object; category_scores: object } | null;
async function withFetch<T>(
  responses: Canned[],
  run: () => Promise<T>,
): Promise<{ out: T; inputs: unknown[] }> {
  const real = globalThis.fetch;
  const inputs: unknown[] = [];
  globalThis.fetch = ((_url: unknown, init: { body: string }) => {
    inputs.push(JSON.parse(init.body).input);
    const r = responses[inputs.length - 1];
    const result = r && "category_scores" in r ? r : { categories: r, category_scores: {} };
    return Promise.resolve(
      r ? Response.json({ results: [result] }) : new Response("boom", { status: 500 }),
    );
  }) as typeof fetch;
  try {
    return { out: await run(), inputs };
  } finally {
    globalThis.fetch = real;
  }
}

const img = { type: "image_url", image_url: { url: "https://x/a.jpg" } };
const quiet = console.error;

Deno.test("moderateItem: text only => one string call", async () => {
  const { out, inputs } = await withFetch([{ hate: true }], () => moderateItem("hi", null));
  assertEquals(inputs, ["hi"]);
  assertEquals(out, { flagged: true, reason: "hate", categories: ["hate"] });
});

Deno.test("moderateItem: image only => one image-array call", async () => {
  const { out, inputs } = await withFetch([{}], () => moderateItem("", "https://x/a.jpg"));
  assertEquals(inputs, [[img]]);
  assertEquals(out, { flagged: false, reason: null, categories: [] });
});

Deno.test("moderateItem: the image call is strict, the text call is not", async () => {
  // Same excluded sexual score on both calls; only the image hides.
  const { out } = await withFetch([sexual, sexual], () => moderateItem("hi", "https://x/a.jpg"));
  assertEquals(out, { flagged: true, reason: "sexual", categories: ["sexual"] });
  const textOnly = await withFetch([sexual], () => moderateItem("hi", null));
  assertEquals(textOnly.out?.flagged, false);
});

Deno.test("moderateItem: text + image => two calls, deduped union", async () => {
  const { out, inputs } = await withFetch(
    [{ hate: true, violence: true }, { violence: true }],
    () => moderateItem("hi", "https://x/a.jpg"),
  );
  assertEquals(inputs, ["hi", [img]]);
  assertEquals(out?.categories.sort(), ["hate", "violence"]);
  assertEquals(out?.flagged, true);
});

Deno.test("moderateItem: a failed call fails closed (null)", async () => {
  console.error = () => {};
  try {
    const { out } = await withFetch([{}, null], () => moderateItem("hi", "https://x/a.jpg"));
    assertEquals(out, null);
  } finally {
    console.error = quiet;
  }
});

Deno.test("moderateItem: nothing to moderate => not flagged, no call", async () => {
  const { out, inputs } = await withFetch([], () => moderateItem("", null));
  assertEquals(inputs, []);
  assertEquals(out, { flagged: false, reason: null, categories: [] });
});
