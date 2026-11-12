// Broadcast push for an admin post. Two callers: the push module's trigger once a
// post an admin asked to send to everyone is visible (push/005_broadcast_trigger.sql,
// with the public anon key), or a dashboard with the service-role key. The anon key
// passes the platform's verify_jwt, so the body is untrusted: only `post_id` is
// read, and an anon call sends nothing unless the post's admin author asked for it
// (core/013_post_broadcasts.sql). `broadcast_at` is claimed before sending, so a
// post goes out once and the inbox lists exactly the posts that were sent.
// Sends an Expo push to every registered token (batches of 100) but the author's,
// each with its member's own unread count as the icon badge.

import { adminClient, fetchAllRows, isServiceCaller } from "../_shared/client.ts";
import { excerptOrPhoto, pushCopy } from "../_shared/copy.ts";
import { sendExpoPushBatch, unreadBadges } from "../_shared/push.ts";
import { BROADCAST_FALLBACK_TITLE } from "../_shared/config.ts";
import { ensureTranslations, resolveTargetLocale, TARGET_LOCALES } from "../_shared/translation.ts";

const supabase = adminClient();

Deno.serve(async (req) => {
  const service = isServiceCaller(req);
  const { post_id } = (await req.json().catch(() => ({}))) as { post_id?: string };
  if (!post_id) return new Response("missing post_id", { status: 400 });

  const { data: post } = await supabase
    .from("posts")
    .select("id, author_id, content, status, broadcast_requested")
    .eq("id", post_id)
    .single();
  if (!post || post.status !== "visible") return new Response("skip: post not visible");

  const { data: author } = await supabase
    .from("profiles")
    .select("username, is_admin")
    .eq("id", post.author_id)
    .single();
  if (!service && !(post.broadcast_requested && author?.is_admin)) {
    return new Response("forbidden", { status: 403 });
  }
  const { data: claimed } = await supabase
    .from("posts")
    .update({ broadcast_at: new Date().toISOString() })
    .eq("id", post.id)
    .is("broadcast_at", null)
    .select("id");
  if (!claimed?.length) return new Response("skip: already sent");
  const title = author?.username?.trim() || BROADCAST_FALLBACK_TITLE;

  // waitMs: when translate-one holds the claim (it fires on the same insert),
  // wait for its rows instead of pushing the source language.
  const translations =
    TARGET_LOCALES.length === 0
      ? []
      : ((await ensureTranslations(supabase, "post", post.id, { waitMs: 20_000 })) ?? []);
  // `profileLocale` picks the "Photo" label for an image-only post (empty
  // content has no translations); `locale` is the resolved translation target.
  const excerptFor = (locale: string | null, profileLocale: string | null): string => {
    const t = locale ? translations.find((r) => r.locale === locale) : undefined;
    return excerptOrPhoto(t?.content ?? post.content, pushCopy(profileLocale).text("photo"));
  };

  // Paged (PostgREST max_rows caps a single select, default 1000) with a total
  // order so pages don't overlap. Newest registration first: a reinstall
  // creates a new anonymous user while the old row keeps the same token, and
  // the dedupe below keeps the first (newest) row's locale. Offset paging can
  // skip a row if one is deleted mid-broadcast — acceptable.
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("push_tokens")
      .select("user_id, expo_push_token, profiles(locale)")
      .not("expo_push_token", "is", null)
      .order("updated_at", { ascending: false })
      .order("user_id")
      .range(from, to),
  );
  // The author's own devices: their center never lists their own post.
  const seen = new Set<string>(
    rows.filter((r) => r.user_id === post.author_id).map((r) => r.expo_push_token as string),
  );
  const recipients = rows
    .map((r) => {
      const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return {
        uid: r.user_id as string,
        to: r.expo_push_token as string,
        profileLocale: (profile?.locale ?? null) as string | null,
        locale: resolveTargetLocale(profile?.locale ?? null),
      };
    })
    .filter((m) => {
      // A stale duplicate token must not double-push.
      if (!m.to || seen.has(m.to)) return false;
      seen.add(m.to);
      return true;
    });
  const badges = await unreadBadges(
    supabase,
    recipients.map((m) => m.uid),
  );
  const messages = recipients.map(({ uid, to, locale, profileLocale }) => ({
    to,
    title,
    body: excerptFor(locale, profileLocale),
    data: { route: "/community", kind: "community_admin_post", postId: post.id },
    badge: badges.get(uid) ?? 1,
  }));
  await sendExpoPushBatch(messages);

  return new Response(JSON.stringify({ sent: messages.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
