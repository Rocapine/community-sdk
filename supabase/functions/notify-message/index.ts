// Group message push: a pg_net trigger (messaging/002_push.sql) fires here once a
// message is ready (visible and passed by moderation). Pushes every member who
// follows the group, except the author, members blocked either way, members whose
// group-message switch is off, and members pushed for this group in the last 60 s
// who haven't read it since. claim_message_push picks and stamps them in one
// statement, so three quick messages push once.
//
// Security: reachable with the public anon key (the trigger calls it that way), so
// the body is UNTRUSTED. Only `record.id` is used; the message is re-read and must
// be ready. Members viewing the conversation are filtered by the host's foreground
// handler (data.conversationId).

import { adminClient } from "../_shared/client.ts";
import {
  type ExpoPushMessage,
  dropInvalidTokens,
  recipientTokens,
  sendExpoPushBatch,
  unreadBadges,
} from "../_shared/push.ts";
import { groupMessageBody, pushCopy } from "../_shared/copy.ts";
import { resolveTargetLocale, runPool } from "../_shared/translation.ts";

const supabase = adminClient();

Deno.serve(async (req) => {
  const { record } = (await req.json().catch(() => ({}))) as { record?: { id?: string } };
  if (!record?.id) return new Response("skip: no id", { status: 400 });

  const { data: message } = await supabase
    .from("messages")
    .select("id, conversation_id, author_id, body, image_path, status, moderated_at")
    .eq("id", record.id)
    .maybeSingle();
  if (!message || message.status !== "visible" || !message.moderated_at) {
    return new Response("skip: not ready");
  }
  const conversationId: string = message.conversation_id;

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (!group) return new Response("skip: not a group");

  const { data: claimed, error } = await supabase.rpc("claim_message_push", {
    p_message: message.id,
  });
  if (error) {
    console.error("notify-message: claim failed", error.message);
    return new Response("error: claim failed", { status: 500 });
  }
  const uids = (claimed ?? []) as string[];
  if (uids.length === 0) return new Response("ok: 0 recipient(s)");

  const [{ data: settings }, { data: author }, { data: translations }, { data: profiles }] =
    await Promise.all([
      supabase.from("messaging_settings").select("settings").eq("id", 1).maybeSingle(),
      supabase.from("profiles").select("username").eq("id", message.author_id).maybeSingle(),
      supabase.from("group_translations").select("locale, name").eq("group_id", conversationId),
      supabase.from("profiles").select("id, locale").in("id", uids),
    ]);
  const preview: string = settings?.settings?.pushPreview ?? "full";
  const names = new Map(
    ((translations ?? []) as { locale: string; name: string | null }[])
      .filter((t) => t.name)
      .map((t) => [t.locale, t.name as string]),
  );
  const localeOf = new Map(
    ((profiles ?? []) as { id: string; locale: string | null }[]).map((p) => [p.id, p.locale]),
  );
  const badges = await unreadBadges(supabase, uids);

  const messages: ExpoPushMessage[] = [];
  await runPool(uids, 10, async (uid) => {
    const { tokens } = await recipientTokens(supabase, uid);
    if (tokens.length === 0) return;
    const locale = localeOf.get(uid) ?? null;
    const copy = pushCopy(locale);
    const target = resolveTargetLocale(locale, [...names.keys()]);
    const title = (target && names.get(target)) || group.name || "";
    const sender = author?.username?.trim() || copy.fallbackName;
    const body = groupMessageBody(copy, preview, sender, message.body, !!message.image_path);
    for (const to of tokens) {
      messages.push({
        to,
        title,
        body,
        data: { route: "/community", kind: "community_message", conversationId },
        badge: badges.get(uid),
        threadId: conversationId,
        collapseId: conversationId,
      });
    }
  });

  const { invalidTokens } = await sendExpoPushBatch(messages);
  await dropInvalidTokens(supabase, invalidTokens);
  return new Response(`ok: ${uids.length} recipient(s), ${messages.length} device(s)`);
});
