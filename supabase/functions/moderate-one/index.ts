// Synchronous single-item moderation. The client inserts a post/comment as
// 'pending' (invisible to others) then calls this to get a verdict: clean ->
// promoted to 'visible' (published); flagged -> 'hidden' (rejected) with the
// reason. On an OpenAI error we fail closed (leave it pending); the daily
// backstop re-checks stale pending items so nothing is silently lost.

import { adminClient, json } from "../_shared/client.ts";
import { assertModerationConfigured, moderateInput } from "../_shared/moderation.ts";

assertModerationConfigured();

const supabase = adminClient();

Deno.serve(async (req) => {
  const { kind, id } = (await req.json()) as { kind: "post" | "comment"; id: string };
  if ((kind !== "post" && kind !== "comment") || !id) {
    return json({ status: "error", error: "bad request" }, 400);
  }
  const table = kind === "post" ? "posts" : "comments";

  const { data: row } = await supabase
    .from(table)
    .select("id, content, status")
    .eq("id", id)
    .single();
  if (!row) return json({ status: "error", error: "not found" });
  // Idempotent: only pending rows are moderated here.
  if (row.status !== "pending") {
    return json({ status: row.status === "visible" ? "published" : row.status });
  }

  // A poll post's option labels are user content too: moderate them together
  // with the question, one verdict for the whole post.
  let input = row.content;
  if (kind === "post") {
    const { data: options } = await supabase
      .from("poll_options")
      .select("label")
      .eq("post_id", id)
      .order("idx");
    if (options && options.length > 0) {
      input = [row.content, ...options.map((o) => o.label)].join("\n");
    }
  }

  const verdict = await moderateInput(input);
  if (!verdict) {
    // Fail closed: leave pending, let the client retry / the daily sweep catch it.
    return json({ status: "pending", error: "moderation unavailable" });
  }

  const now = new Date().toISOString();
  if (verdict.flagged) {
    await supabase
      .from(table)
      .update({ status: "hidden", moderation_reason: verdict.reason, moderated_at: now })
      .eq("id", id);
    return json({ status: "rejected", reason: verdict.reason });
  }
  await supabase.from(table).update({ status: "visible", moderated_at: now }).eq("id", id);
  return json({ status: "published" });
});
