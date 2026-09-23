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

  const depth = Number(req.headers.get("x-community-chain")) || 0;
  let chained = false;
  if (remaining > 0 && done > 0 && depth < MAX_CHAIN) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/daily-translation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          "Content-Type": "application/json",
          "x-community-chain": String(depth + 1),
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      chained = true;
    } catch {
      // Aborted after 2s (or another fetch error): the request has already
      // been sent, so the chained run continues server-side regardless.
      chained = true;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (failed > 0) {
    await postToSlack({
      text: `Daily translation: WARNING, ${failed} item(s) failed to translate (${posts.done} posts and ${comments.done} comments done, ${remaining} remaining); they will be retried tomorrow.`,
    });
  }
  return json({ posts: posts.done, comments: comments.done, failed, remaining, chained, depth });
});
