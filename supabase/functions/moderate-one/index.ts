// Synchronous single-item moderation. The client inserts a post/comment as
// 'pending' (invisible to others) then calls this to get a verdict: clean ->
// promoted to 'visible' (published); flagged -> 'hidden' (rejected) with the
// reason. On an OpenAI error we fail closed (leave it pending); the daily
// backstop re-checks stale pending items so nothing is silently lost.
//
// Security: the caller must be the row's author (resolved from their user
// JWT through Auth) or the service role — an anon-key-only call can't
// moderate someone else's pending item. Every status write is guarded with
// `status = 'pending'` so a row the author deleted mid-flight is never
// resurrected.

import { adminClient, callerUserId, isServiceCaller, json } from "../_shared/client.ts";
import { assertModerationConfigured, moderateInput } from "../_shared/moderation.ts";

assertModerationConfigured();

const supabase = adminClient();

Deno.serve(async (req) => {
  const { kind, id } = (await req.json().catch(() => ({}))) as {
    kind?: "post" | "comment";
    id?: string;
  };
  if ((kind !== "post" && kind !== "comment") || !id) {
    return json({ status: "error", error: "bad request" }, 400);
  }
  const table = kind === "post" ? "posts" : "comments";

  const { data: row } = await supabase
    .from(table)
    .select("id, author_id, content, status")
    .eq("id", id)
    .single();
  if (!row) return json({ status: "error", error: "not found" });

  if (!isServiceCaller(req)) {
    const uid = await callerUserId(req);
    if (!uid || uid !== row.author_id) return json({ status: "error", error: "forbidden" }, 403);
  }

  // Idempotent: only pending rows are moderated here.
  if (row.status !== "pending") {
    return json({ status: row.status === "visible" ? "published" : row.status });
  }

  // A poll post's option labels are user content too: moderate them together
  // with the question, one verdict for the whole post. The polls module is
  // optional — on an install without it the table doesn't exist and the
  // query errors, which simply means "no options".
  let input = row.content;
  if (kind === "post") {
    const { data: options, error } = await supabase
      .from("poll_options")
      .select("label")
      .eq("post_id", id)
      .order("idx");
    if (!error && options && options.length > 0) {
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
      .eq("id", id)
      .eq("status", "pending");
    return json({ status: "rejected", reason: verdict.reason });
  }
  const { data: updated } = await supabase
    .from(table)
    .update({ status: "visible", moderated_at: now })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  // Nothing updated: the author deleted (or a sweep moderated) it meanwhile.
  if (!updated || updated.length === 0) return json({ status: "pending" });
  return json({ status: "published" });
});
