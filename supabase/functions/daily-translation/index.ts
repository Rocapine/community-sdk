// Daily translation sweep: back-fills the history after installation and
// catches every item translate-one missed (API outage, secret set later, a
// locale added to COMMUNITY_TRANSLATION_LOCALES). Each invocation runs a
// bounded time budget at limited concurrency, then self-chains (POSTs itself)
// to keep going until the backlog is drained or MAX_CHAIN is hit. Quiet
// unless something failed.

import { adminClient, json } from "../_shared/client.ts";
import { ensureTranslations, runPool, TARGET_LOCALES } from "../_shared/translation.ts";
import { postToSlack } from "../_shared/slack.ts";

const supabase = adminClient();
const MAX_ITEMS_PER_KIND = 250;
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 60_000;
const MAX_CHAIN = 200;

async function sweep(
  kind: "post" | "comment",
  withinBudget: () => boolean,
): Promise<{ done: number; failed: number; remaining: number }> {
  const { data, error } = await supabase.rpc("items_missing_translations", {
    kind,
    target_locales: TARGET_LOCALES,
    max_items: MAX_ITEMS_PER_KIND,
  });
  if (error) {
    console.error("items_missing_translations failed", error.message);
    return { done: 0, failed: 1, remaining: 0 };
  }
  const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
  const { results, processed } = await runPool(
    ids,
    CONCURRENCY,
    (id) => ensureTranslations(supabase, kind, id),
    withinBudget,
  );
  const done = results.filter((r) => r !== null).length;
  const failed = processed - done;
  const remaining = Math.max(ids.length - processed, ids.length === MAX_ITEMS_PER_KIND ? 1 : 0);
  return { done, failed, remaining };
}

Deno.serve(async (req) => {
  if (TARGET_LOCALES.length === 0) {
    return json({
      posts: 0,
      comments: 0,
      failed: 0,
      note: "COMMUNITY_TRANSLATION_LOCALES not set",
    });
  }
  const started = Date.now();
  const withinBudget = () => Date.now() - started < TIME_BUDGET_MS;

  const posts = await sweep("post", withinBudget);
  const comments = await sweep("comment", withinBudget);
  const done = posts.done + comments.done;
  const failed = posts.failed + comments.failed;
  const remaining = posts.remaining + comments.remaining;

  // The endpoint only needs the public anon key, so the caller controls this
  // header: clamp to a non-negative integer so a malicious/garbage value (a
  // large negative number, NaN, -Infinity) can't bypass MAX_CHAIN.
  const depth = Math.max(0, Math.trunc(Number(req.headers.get("x-community-chain"))) || 0);
  let chained = false;
  if (remaining > 0 && done > 0 && depth < MAX_CHAIN) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/daily-translation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          "Content-Type": "application/json",
          "x-community-chain": String(depth + 1),
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      chained = res.ok;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // We stopped waiting after 2s; the request was already sent and the
        // chained run continues server-side regardless of our response.
        chained = true;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // Only the last link of a chain reports: an item that always fails would
  // otherwise post a warning on every one of up to 200 chained links.
  if (failed > 0 && !chained) {
    await postToSlack({
      text: `Daily translation: WARNING, ${failed} item(s) failed to translate (${posts.done} posts and ${comments.done} comments done, ${remaining} remaining); they will be retried by the next sweep.`,
    });
  }
  return json({ posts: posts.done, comments: comments.done, failed, remaining, chained, depth });
});
