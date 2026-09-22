// Broadcast push for an official dashboard post: Rocactopus invokes this with
// the service-role key after composing a post with "Send push notification"
// checked. Sends an Expo push to every registered token (batches of 100).
// Guarded by a service-role check — the public anon key passes the platform's
// verify_jwt but must NOT be able to trigger a broadcast.

import { adminClient, isServiceCaller } from "../_shared/client.ts";
import { sendExpoPushBatch } from "../_shared/push.ts";
import { BROADCAST_FALLBACK_TITLE } from "../_shared/config.ts";

const supabase = adminClient();

Deno.serve(async (req) => {
  if (!isServiceCaller(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  const { post_id } = (await req.json()) as { post_id?: string };
  if (!post_id) return new Response("missing post_id", { status: 400 });

  const { data: post } = await supabase
    .from("posts")
    .select("id, author_id, content, status")
    .eq("id", post_id)
    .single();
  if (!post || post.status !== "visible") return new Response("skip: post not visible");

  const { data: author } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", post.author_id)
    .single();
  const title = author?.username?.trim() || BROADCAST_FALLBACK_TITLE;
  const excerpt = post.content.length > 140 ? `${post.content.slice(0, 137)}...` : post.content;

  const { data: rows } = await supabase
    .from("push_tokens")
    .select("expo_push_token")
    .not("expo_push_token", "is", null);
  const tokens = (rows ?? []).map((r) => r.expo_push_token as string).filter(Boolean);

  await sendExpoPushBatch(
    tokens.map((to) => ({
      to,
      title,
      body: excerpt,
      data: { route: "/community", kind: "community_official_post" },
      badge: 1,
    })),
  );

  return new Response(JSON.stringify({ sent: tokens.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
