// Daily moderation batch + backstop. Runs every not-yet-moderated post/comment
// through OpenAI's moderation endpoint (free): flagged -> soft-hide, clean
// 'pending' -> promote to 'visible' (catches items whose synchronous
// moderate-one call failed), clean 'visible' -> just stamp. Posts a Slack
// summary (no-op if SLACK_WEBHOOK_URL is unset — see _shared/slack.ts). Never
// deletes rows. App criticism is not a category (stays visible).

import { adminClient } from "../_shared/client.ts";
import {
  assertModerationConfigured,
  flaggedCategories,
  type ModerationResult,
} from "../_shared/moderation.ts";
import { postToSlack } from "../_shared/slack.ts";

assertModerationConfigured();

const supabase = adminClient();

interface Item {
  id: string;
  content: string;
  author_id: string;
  status: string;
  profiles: {
    username: string | null;
    amplitude_id: string | null;
    revenuecat_id: string | null;
  } | null;
  table: "posts" | "comments";
}

// Without generated DB types, supabase-js can't tell a `profiles!fk(...)`
// embed is to-one, so its inferred type is an array; normalize it to a
// single row (or null) to match Item.profiles above.
function toOne<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

Deno.serve(async () => {
  const { data: posts, error: postsError } = await supabase
    .from("posts")
    .select(
      "id, content, author_id, status, poll_options(idx, label), profiles!posts_author_id_fkey(username, amplitude_id, revenuecat_id)",
    )
    .is("moderated_at", null)
    .in("status", ["pending", "visible"]);
  const { data: comments, error: commentsError } = await supabase
    .from("comments")
    .select("id, content, author_id, status, profiles(username, amplitude_id, revenuecat_id)")
    .is("moderated_at", null)
    .in("status", ["pending", "visible"]);
  if (postsError || commentsError) {
    return new Response(JSON.stringify({ error: (postsError ?? commentsError)!.message }), {
      status: 500,
    });
  }

  // Poll option labels are user content: fold them into the post's moderated
  // text (same treatment as the synchronous moderate-one function).
  const items: Item[] = [
    ...(posts ?? []).map((p) => ({
      ...p,
      profiles: toOne(p.profiles),
      content: [
        p.content,
        ...(p.poll_options ?? [])
          .sort((a: { idx: number }, b: { idx: number }) => a.idx - b.idx)
          .map((o: { label: string }) => o.label),
      ].join("\n"),
      table: "posts" as const,
    })),
    ...(comments ?? []).map((c) => ({
      ...c,
      profiles: toOne(c.profiles),
      table: "comments" as const,
    })),
  ];
  if (items.length === 0) {
    return new Response(JSON.stringify({ checked: 0, hidden: 0, failed_batches: 0 }));
  }

  // Moderate in batches of 100 (API limit). Only items whose batch succeeded
  // get stamped moderated_at, so a transient failure is retried tomorrow.
  const flagged: { item: Item; categories: string[] }[] = [];
  const processed: Item[] = [];
  let failedBatches = 0;
  for (let i = 0; i < items.length; i += 100) {
    const batch = items.slice(i, i + 100);
    try {
      const res = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: batch.map((it) => it.content),
        }),
      });
      if (!res.ok) {
        failedBatches++;
        continue; // skip stamping; retried next run
      }
      const { results } = await res.json();
      results.forEach((r: ModerationResult, idx: number) => {
        const cats = flaggedCategories(r);
        if (cats.length > 0) flagged.push({ item: batch[idx], categories: cats });
      });
      processed.push(...batch);
    } catch {
      failedBatches++; // network error; skip stamping, retried next run
    }
  }
  const totalItems = items.length;

  const flaggedIds = new Set(flagged.map((f) => f.item.id));
  for (const { item, categories } of flagged) {
    await supabase
      .from(item.table)
      .update({ status: "hidden", moderation_reason: categories.join(",") })
      .eq("id", item.id);
  }
  // Backstop: promote clean 'pending' items to 'visible' (their synchronous
  // moderate-one call must have failed).
  const promote = processed.filter((i) => i.status === "pending" && !flaggedIds.has(i.id));
  const promotePostIds = promote.filter((i) => i.table === "posts").map((i) => i.id);
  const promoteCommentIds = promote.filter((i) => i.table === "comments").map((i) => i.id);
  if (promotePostIds.length > 0) {
    await supabase.from("posts").update({ status: "visible" }).in("id", promotePostIds);
  }
  if (promoteCommentIds.length > 0) {
    await supabase.from("comments").update({ status: "visible" }).in("id", promoteCommentIds);
  }
  const now = new Date().toISOString();
  const processedPostIds = processed.filter((i) => i.table === "posts").map((i) => i.id);
  const processedCommentIds = processed.filter((i) => i.table === "comments").map((i) => i.id);
  if (processedPostIds.length > 0) {
    await supabase.from("posts").update({ moderated_at: now }).in("id", processedPostIds);
  }
  if (processedCommentIds.length > 0) {
    await supabase.from("comments").update({ moderated_at: now }).in("id", processedCommentIds);
  }

  const lines = flagged.map(({ item, categories }) => {
    const p = item.profiles;
    return (
      `* [${item.table}] *${p?.username ?? item.author_id}*, _${categories.join(", ")}_\n` +
      `  > ${item.content.slice(0, 200)}\n` +
      `  amplitude: \`${p?.amplitude_id ?? "?"}\` | revenuecat: \`${p?.revenuecat_id ?? "?"}\``
    );
  });
  let summaryText: string;
  if (failedBatches > 0) {
    const uncheckedCount = totalItems - processed.length;
    summaryText =
      `Daily moderation: WARNING, ${failedBatches} batch(es) failed to reach the moderation API ` +
      `(${uncheckedCount} of ${totalItems} items were not checked and will be retried). ` +
      `${flagged.length} items hidden.`;
  } else if (flagged.length === 0) {
    summaryText = `Daily moderation: ${processed.length} items checked, nothing to report.`;
  } else {
    summaryText = `Daily moderation: ${flagged.length}/${processed.length} items hidden\n\n${lines.join("\n")}`;
  }
  await postToSlack({ text: summaryText });

  return new Response(
    JSON.stringify({
      checked: processed.length,
      hidden: flagged.length,
      failed_batches: failedBatches,
    }),
  );
});
