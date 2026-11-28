// Message push: a pg_net trigger (messaging/002_push.sql) fires here once a message is
// ready (visible and passed by moderation). claim_message_push (dms/002 with the DMs
// module, else messaging/002) picks the recipients and stamps them in one statement, so
// three quick messages push once (60 s per conversation unless read since), and claims
// the message itself (messages.pushed_at), so a message pushes at most once, edits
// included. Never the author or a member blocked either way.
//  - Group: members who follow the group and have notify_group_messages on; title = the
//    group's name.
//  - DM: the other member (DMs are always followed) with notify_dms on, never a declined
//    request nor a message before their visible_from. A request pushes once, on its first
//    message, neutral (dmPushPayload); an accepted DM like a group, the sender as title.
// A host that adds `push` after `messaging` must re-run messaging/002_push.sql (then
// dms/002_push.sql with DMs).
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
import { dmPushPayload } from "../_shared/messaging.ts";
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

  const { data: conversation } = await supabase
    .from("conversations")
    .select("kind")
    .eq("id", conversationId)
    .maybeSingle();
  const isDm = conversation?.kind === "dm";
  let group: { name: string | null } | null = null;
  if (!isDm) {
    const { data } = await supabase
      .from("groups")
      .select("name, status")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (!data) return new Response("skip: not a group");
    // A pending (its creator's own messages), hidden or deleted group pushes nobody.
    if (data.status !== "visible") return new Response("skip: group not visible");
    group = data;
  }

  const { data: claimed, error } = await supabase.rpc("claim_message_push", {
    p_message: message.id,
  });
  if (error) {
    console.error("notify-message: claim failed", error.message);
    return new Response("error: claim failed", { status: 500 });
  }
  // kind: "message" | "request" (dms/002); absent before it, i.e. groups only.
  const recipients = (claimed ?? []) as {
    user_id: string;
    locale: string | null;
    kind?: string;
  }[];
  if (recipients.length === 0) return new Response("ok: 0 recipient(s)");

  const [{ data: settings }, { data: author }, { data: translations }] = await Promise.all([
    supabase.from("messaging_settings").select("settings").eq("id", 1).maybeSingle(),
    supabase.from("profiles").select("username").eq("id", message.author_id).maybeSingle(),
    isDm
      ? Promise.resolve({ data: [] })
      : supabase.from("group_translations").select("locale, name").eq("group_id", conversationId),
  ]);
  const preview: string = settings?.settings?.pushPreview ?? "full";
  const names = new Map(
    ((translations ?? []) as { locale: string; name: string | null }[])
      .filter((t) => t.name)
      .map((t) => [t.locale, t.name as string]),
  );

  const reachable: ((typeof recipients)[number] & { tokens: string[] })[] = [];
  await runPool(recipients, 10, async (r) => {
    const { tokens } = await recipientTokens(supabase, r.user_id);
    if (tokens.length > 0) reachable.push({ ...r, tokens });
  });
  // Badges only for the members a push actually reaches.
  const badges = await unreadBadges(
    supabase,
    reachable.map((r) => r.user_id),
  );

  const messages: ExpoPushMessage[] = [];
  for (const { user_id, locale, kind, tokens } of reachable) {
    const copy = pushCopy(locale);
    const sender = author?.username?.trim() || copy.fallbackName;
    const hasImage = !!message.image_path;
    let title: string | undefined;
    let body: string;
    if (isDm) {
      ({ title, body } = dmPushPayload(
        copy,
        kind ?? "request",
        preview,
        sender,
        message.body,
        hasImage,
      ));
    } else {
      const target = resolveTargetLocale(locale, [...names.keys()]);
      title = (target && names.get(target)) || group?.name || "";
      body = groupMessageBody(copy, preview, sender, message.body, hasImage);
    }
    for (const to of tokens) {
      messages.push({
        to,
        title,
        body,
        data: { route: "/community", kind: "community_message", conversationId },
        badge: badges.get(user_id),
        threadId: conversationId,
        collapseId: conversationId,
      });
    }
  }

  const { invalidTokens } = await sendExpoPushBatch(messages);
  await dropInvalidTokens(supabase, invalidTokens);
  return new Response(`ok: ${recipients.length} recipient(s), ${messages.length} device(s)`);
});
