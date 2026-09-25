// Real-time comment notification: a pg_net trigger fires here when a comment
// becomes visible (published). We push to the post author (unless self, opted
// out, no token, or the author has blocked the commenter).
//
// Security: this function is reachable with the public anon key (the trigger
// calls it that way), so the body is UNTRUSTED. Only `record.id` is used; the
// comment is re-read from the database and must be visible — nothing in the
// push comes from the request itself.

import { adminClient } from "../_shared/client.ts";
import { sendExpoPush } from "../_shared/push.ts";
import { pushCopy } from "../_shared/copy.ts";
import { ensureTranslations, resolveTargetLocale, languageOf } from "../_shared/translation.ts";

const supabase = adminClient();

Deno.serve(async (req) => {
  const { record } = (await req.json().catch(() => ({}))) as { record?: { id?: string } };
  if (!record?.id) return new Response("skip: no id", { status: 400 });

  const { data: comment } = await supabase
    .from("comments")
    .select("id, post_id, author_id, content, status")
    .eq("id", record.id)
    .single();
  if (!comment || comment.status !== "visible") return new Response("skip: not visible");

  const { data: post } = await supabase
    .from("posts")
    .select("author_id")
    .eq("id", comment.post_id)
    .single();
  if (!post || post.author_id === comment.author_id) return new Response("skip: self/none");

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
    .eq("blocked_id", comment.author_id)
    .maybeSingle();
  if (blocked) return new Response("skip: blocked");

  const { data: recipient } = await supabase
    .from("profiles")
    .select("locale")
    .eq("id", post.author_id)
    .single();
  const copy = pushCopy(recipient?.locale);

  const { data: actor } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", comment.author_id)
    .single();
  const name = actor?.username?.trim() || copy.fallbackName;
  // Recipient-language excerpt when the translation module is on: translate
  // now (a few seconds) rather than push the source language; on failure the
  // original goes out and the sweep fills the rows later. translate-one fires
  // on the same insert, so when it holds the claim wait up to 20 s (the OpenAI
  // request timeout) for its rows.
  let excerptSource = comment.content;
  const targetLocale = resolveTargetLocale(recipient?.locale);
  if (targetLocale) {
    const rows = await ensureTranslations(supabase, "comment", comment.id, { waitMs: 20_000 });
    const match = rows?.find(
      (r) => r.locale === targetLocale && languageOf(r.locale) !== r.source_locale,
    );
    if (match) excerptSource = match.content;
  }
  const excerpt = excerptSource.length > 140 ? `${excerptSource.slice(0, 137)}...` : excerptSource;
  // Title states the event; body is the commenter's name then the comment in
  // quotes, e.g.  Marie: "So happy for you!".
  const body = `${name}: "${excerpt}"`;

  await sendExpoPush({
    to: pref.expo_push_token,
    title: copy.text("comment.title"),
    body,
    data: { route: "/community", kind: "community_comment" },
    badge: 1,
  });
  return new Response("ok");
});
