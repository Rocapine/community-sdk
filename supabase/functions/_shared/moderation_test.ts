import { assertEquals } from "jsr:@std/assert@1";

// SCORE_HIDE is computed at module load from env, so set it before importing.
Deno.env.set("MODERATION_EXCLUDED_CATEGORIES", "sexual");
const { flaggedCategories, moderateItem } = await import("./moderation.ts");

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

// Stubs fetch with one canned moderation result per call.
async function withFetch<T>(
  responses: (Record<string, boolean> | null)[],
  run: () => Promise<T>,
): Promise<{ out: T; inputs: unknown[] }> {
  const real = globalThis.fetch;
  const inputs: unknown[] = [];
  globalThis.fetch = ((_url: unknown, init: { body: string }) => {
    inputs.push(JSON.parse(init.body).input);
    const cats = responses[inputs.length - 1];
    return Promise.resolve(
      cats
        ? Response.json({ results: [{ categories: cats, category_scores: {} }] })
        : new Response("boom", { status: 500 }),
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
