// Coalesced like notifications. Trigger path (body has record): apply a 10-min
// per-post cooldown so bursts do not spam. Digest path (no record, from cron):
// sweep posts with unnotified likes older than the cooldown. Either way, group
// as "<name> liked your post" (1) or "<name> and N others liked your post".

import { adminClient } from "../_shared/client.ts";
import { sendExpoPush } from "../_shared/push.ts";
import { FALLBACK_ACTOR_NAME } from "../_shared/config.ts";

const supabase = adminClient();
const COOLDOWN_MS = 10 * 60 * 1000;

/** Notify the author for a single post's currently-unnotified likes, then
 *  stamp them. Assumes the cooldown decision is already made. */
async function flushPost(postId: string) {
  const { data: post } = await supabase.from("posts").select("author_id").eq("id", postId).single();
  if (!post) return;

  const { data: pref } = await supabase
    .from("push_tokens")
    .select("expo_push_token, notify_likes")
    .eq("user_id", post.author_id)
    .single();

  const { data: unnotified } = await supabase
    .from("likes")
    .select("user_id, created_at")
    .eq("post_id", postId)
    .is("notified_at", null)
    .order("created_at", { ascending: false });
  if (!unnotified || unnotified.length === 0) return;

  // Stamp ALL unnotified likes for this post (clears the queue), regardless of
  // whether they contribute to the message.
  const now = new Date().toISOString();
  await supabase
    .from("likes")
    .update({ notified_at: now })
    .eq("post_id", postId)
    .is("notified_at", null);

  if (!pref?.expo_push_token || !pref.notify_likes) return;

  // Contributors = likers who are not the author and not blocked by the author.
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
  const name = actor?.username?.trim() || FALLBACK_ACTOR_NAME;
  const title =
    contributors.length === 1
      ? `${name} liked your post`
      : `${name} and ${contributors.length - 1} others liked your post`;

  await sendExpoPush({
    to: pref.expo_push_token,
    title,
    data: { route: "/community", kind: "community_like" },
    badge: 1,
  });
}

Deno.serve(async (req) => {
  const payload = (await req.json().catch(() => ({}))) as {
    record?: { post_id: string };
  };

  if (payload.record?.post_id) {
    const postId = payload.record.post_id;
    // Cooldown: if any like on this post was notified within COOLDOWN_MS, hold.
    const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const { count } = await supabase
      .from("likes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId)
      .gt("notified_at", since);
    if ((count ?? 0) > 0) return new Response("hold: cooldown");
    await flushPost(postId);
    return new Response("ok");
  }

  // Digest (cron): sweep posts whose oldest unnotified like is past the cooldown.
  const cutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data: stale } = await supabase
    .from("likes")
    .select("post_id")
    .is("notified_at", null)
    .lt("created_at", cutoff);
  const postIds = [...new Set((stale ?? []).map((r) => r.post_id as string))];
  for (const pid of postIds) await flushPost(pid);
  return new Response(JSON.stringify({ swept: postIds.length }));
});
