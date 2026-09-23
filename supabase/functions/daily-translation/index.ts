// Daily translation sweep: back-fills the history after installation and
// catches every item translate-one missed (API outage, secret set later, a
// locale added to COMMUNITY_TRANSLATION_LOCALES). Capped per run to fit the
// function's time budget; quiet unless something failed.

import { adminClient, json } from "../_shared/client.ts";
import { ensureTranslations, TARGET_LOCALES } from "../_shared/translation.ts";
import { postToSlack } from "../_shared/slack.ts";

const supabase = adminClient();
const MAX_ITEMS_PER_KIND = 250;

async function sweep(kind: "post" | "comment"): Promise<{ done: number; failed: number }> {
  const { data, error } = await supabase.rpc("items_missing_translations", {
    kind,
    target_locales: TARGET_LOCALES,
    max_items: MAX_ITEMS_PER_KIND,
  });
  if (error) {
    console.error("items_missing_translations failed", error.message);
    return { done: 0, failed: 1 };
  }
  let done = 0;
  let failed = 0;
  for (const row of (data ?? []) as { id: string }[]) {
    const result = await ensureTranslations(supabase, kind, row.id);
    if (result === null) failed++;
    else done++;
  }
  return { done, failed };
}

Deno.serve(async () => {
  if (TARGET_LOCALES.length === 0) {
    return json({
      posts: 0,
      comments: 0,
      failed: 0,
      note: "COMMUNITY_TRANSLATION_LOCALES not set",
    });
  }
  const posts = await sweep("post");
  const comments = await sweep("comment");
  const failed = posts.failed + comments.failed;
  if (failed > 0) {
    await postToSlack({
      text: `Daily translation: WARNING, ${failed} item(s) failed to translate (${posts.done} posts and ${comments.done} comments done); they will be retried tomorrow.`,
    });
  }
  return json({ posts: posts.done, comments: comments.done, failed });
});
