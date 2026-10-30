// Real-time comment notification: a pg_net trigger fires here when a comment
// becomes visible (published). We push to the post author, or for a reply to
// the author of the comment it answers only (unless self, opted out, no token,
// or the recipient has blocked the commenter).
//
// Security: this function is reachable with the public anon key (the trigger
// calls it that way), so the body is UNTRUSTED. Only `record.id` is used; the
// comment is re-read from the database and must be visible — nothing in the
// push comes from the request itself.

import { adminClient } from "../_shared/client.ts";
import { sendExpoPush, unreadBadge } from "../_shared/push.ts";
import { excerptOrPhoto, pushCopy } from "../_shared/copy.ts";
import { ensureTranslations, resolveTargetLocale, languageOf } from "../_shared/translation.ts";

const supabase = adminClient();

Deno.serve(async (req) => {
  const { record } = (await req.json().catch(() => ({}))) as { record?: { id?: string } };
  if (!record?.id) return new Response("skip: no id", { status: 400 });

  const { data: comment } = await supabase
    .from("comments")
    .select("id, post_id, author_id, content, status, parent_id")
    .eq("id", record.id)
    .single();
  if (!comment || comment.status !== "visible") return new Response("skip: not visible");

  const { data: post } = await supabase
    .from("posts")
    .select("author_id")
    .eq("id", comment.post_id)
    .single();
  if (!post) return new Response("skip: no post");

  // A reply pushes only the author of the comment it answers; the post author
  // is pushed for top-level comments (mirrors the inbox trigger,
  // inbox/002_replies_and_reads.sql).
  let parentAuthor: string | null = null;
  if (comment.parent_id) {
    const { data: parent } = await supabase
      .from("comments")
      .select("author_id")
      .eq("id", comment.parent_id)
      .maybeSingle();
    parentAuthor = parent?.author_id ?? null;
  }
  const targets: { uid: string; title: "reply.title" | "comment.title"; kind: string }[] = [];
  if (parentAuthor && parentAuthor !== comment.author_id) {
    targets.push({ uid: parentAuthor, title: "reply.title", kind: "community_reply" });
  }
  if (!parentAuthor && post.author_id !== comment.author_id) {
    targets.push({ uid: post.author_id, title: "comment.title", kind: "community_comment" });
  }
  if (targets.length === 0) return new Response("skip: self/none");

  const { data: actor } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", comment.author_id)
    .single();

  const postId = comment.post_id;
  for (const target of targets) await pushTo(target, actor?.username ?? null);
  return new Response("ok");

  async function pushTo(
    target: { uid: string; title: "reply.title" | "comment.title"; kind: string },
    actorName: string | null,
  ) {
    const { data: pref } = await supabase
      .from("push_tokens")
      .select("expo_push_token, notify_comments")
      .eq("user_id", target.uid)
      .single();
    if (!pref?.expo_push_token || !pref.notify_comments) return;

    const { data: blocked } = await supabase
      .from("blocks")
      .select("blocker_id")
      .eq("blocker_id", target.uid)
      .eq("blocked_id", comment!.author_id)
      .maybeSingle();
    if (blocked) return;

    const { data: recipient } = await supabase
      .from("profiles")
      .select("locale")
      .eq("id", target.uid)
      .single();
    const copy = pushCopy(recipient?.locale);
    const name = actorName?.trim() || copy.fallbackName;
    // Recipient-language excerpt when the translation module is on: translate
    // now (a few seconds) rather than push the source language; on failure the
    // original goes out and the sweep fills the rows later. translate-one fires
    // on the same insert, so when it holds the claim wait up to 20 s (the OpenAI
    // request timeout) for its rows.
    let excerptSource = comment!.content;
    const targetLocale = resolveTargetLocale(recipient?.locale);
    if (targetLocale) {
      const rows = await ensureTranslations(supabase, "comment", comment!.id, { waitMs: 20_000 });
      const match = rows?.find(
        (r) => r.locale === targetLocale && languageOf(r.locale) !== r.source_locale,
      );
      if (match) excerptSource = match.content;
    }
    // Title states the event; body is the commenter's name then the comment in
    // quotes, e.g.  Marie: "So happy for you!". An image-only comment has no text:
    // the localized "Photo" label stands in, unquoted.
    const body = comment!.content.trim()
      ? `${name}: "${excerptOrPhoto(excerptSource, "")}"`
      : `${name}: ${copy.text("photo")}`;

    await sendExpoPush({
      to: pref.expo_push_token,
      title: copy.text(target.title),
      body,
      data: { route: "/community", kind: target.kind, postId },
      badge: await unreadBadge(supabase, target.uid),
    });
  }
});
