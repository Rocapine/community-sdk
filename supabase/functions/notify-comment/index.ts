// Real-time comment notification: a pg_net trigger on comments posts the new
// row here. We push to the post author (unless self, opted out, no token, or
// the author has blocked the commenter).

import { adminClient } from "../_shared/client.ts";
import { sendExpoPush } from "../_shared/push.ts";
import { FALLBACK_ACTOR_NAME } from "../_shared/config.ts";

const supabase = adminClient();

interface CommentRecord {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
}

Deno.serve(async (req) => {
  const { record } = (await req.json()) as { record: CommentRecord };

  const { data: post } = await supabase
    .from("posts")
    .select("author_id")
    .eq("id", record.post_id)
    .single();
  if (!post || post.author_id === record.author_id) return new Response("skip: self/none");

  const { data: pref } = await supabase
    .from("push_tokens")
    .select("expo_push_token, notify_comments")
    .eq("user_id", post.author_id)
    .single();
  if (!pref?.expo_push_token || !pref.notify_comments) return new Response("skip: no token/pref");

  const { data: blocked } = await supabase
    .from("blocks")
    .select("blocker_id")
    .eq("blocker_id", post.author_id)
    .eq("blocked_id", record.author_id)
    .maybeSingle();
  if (blocked) return new Response("skip: blocked");

  const { data: actor } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", record.author_id)
    .single();
  const name = actor?.username?.trim() || FALLBACK_ACTOR_NAME;
  const excerpt =
    record.content.length > 140 ? `${record.content.slice(0, 137)}...` : record.content;
  // Title states the event; body is the commenter's name then the comment in
  // quotes, e.g.  Marie: "So happy for you!".
  const body = `${name}: "${excerpt}"`;

  await sendExpoPush({
    to: pref.expo_push_token,
    title: "You received a comment",
    body,
    data: { route: "/community", kind: "community_comment" },
    badge: 1,
  });
  return new Response("ok");
});
