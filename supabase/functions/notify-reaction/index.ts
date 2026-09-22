// Coalesced reaction notifications (generic "I stand with you" reaction — see
// supabase/migrations/reaction/001_reactions.sql; the reaction's *meaning* is
// 100% client-side, this function only sends the push). Trigger path (body
// has record): 10-min per-post cooldown. Digest path (no record, from cron):
// sweep posts with unnotified reactions older than the cooldown. Never
// includes any reaction content — the reaction table carries no text.
//
// Push copy: the recipient's profiles.locale selects the built-in neutral
// copy ("{name} is thinking of you" / "… and N others …") — an app with its
// own reaction semantics overrides it per locale with the COMMUNITY_PUSH_COPY
// secret (see _shared/copy.ts; the older COMMUNITY_REACTION_PUSH_TEXT single
// string still works for the single-reactor case).
//
// Security: same as notify-like — only `record.post_id` is read from the
// untrusted body; everything else comes from post_reactions.

import { adminClient } from "../_shared/client.ts";
import { sendExpoPush } from "../_shared/push.ts";
import { pushCopy } from "../_shared/copy.ts";

const supabase = adminClient();
const COOLDOWN_MS = 10 * 60 * 1000;

async function flushPost(postId: string) {
  const { data: post } = await supabase.from("posts").select("author_id").eq("id", postId).single();
  if (!post) return;

  const { data: recipient } = await supabase
    .from("profiles")
    .select("locale")
    .eq("id", post.author_id)
    .single();
  const copy = pushCopy(recipient?.locale);

  const { data: pref } = await supabase
    .from("push_tokens")
    .select("expo_push_token, notify_reactions")
    .eq("user_id", post.author_id)
    .single();

  const { data: unnotified } = await supabase
    .from("post_reactions")
    .select("user_id, created_at")
    .eq("post_id", postId)
    .is("notified_at", null)
    .order("created_at", { ascending: false });
  if (!unnotified || unnotified.length === 0) return;

  const now = new Date().toISOString();
  await supabase
    .from("post_reactions")
    .update({ notified_at: now })
    .eq("post_id", postId)
    .is("notified_at", null);

  if (!pref?.expo_push_token || !pref.notify_reactions) return;

  const { data: blocks } = await supabase
    .from("blocks")
    .select("blocked_id")
    .eq("blocker_id", post.author_id);
  const blockedSet = new Set((blocks ?? []).map((b) => b.blocked_id as string));
  const contributors = unnotified.filter(
    (l) => l.user_id !== post.author_id && !blockedSet.has(l.user_id as string),
  );
  if (contributors.length === 0) return;

  const { data: actor } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", contributors[0].user_id)
    .single();
  const name = actor?.username?.trim() || copy.fallbackName;
  const title =
    contributors.length === 1
      ? copy.text("reaction.one", { name })
      : copy.text("reaction.many", { name, count: contributors.length - 1 });

  await sendExpoPush({
    to: pref.expo_push_token,
    title,
    data: { route: "/community", kind: "community_reaction" },
    badge: 1,
  });
}

Deno.serve(async (req) => {
  const payload = (await req.json().catch(() => ({}))) as {
    record?: { post_id: string };
  };

  if (payload.record?.post_id) {
    const postId = payload.record.post_id;
    const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const { count } = await supabase
      .from("post_reactions")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId)
      .gt("notified_at", since);
    if ((count ?? 0) > 0) return new Response("hold: cooldown");
    await flushPost(postId);
    return new Response("ok");
  }

  const cutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data: stale } = await supabase
    .from("post_reactions")
    .select("post_id")
    .is("notified_at", null)
    .lt("created_at", cutoff);
  const postIds = [...new Set((stale ?? []).map((r) => r.post_id as string))];
  for (const pid of postIds) await flushPost(pid);
  return new Response(JSON.stringify({ swept: postIds.length }));
});
