// Broadcast push for an official dashboard post: Rocactopus invokes this with
// the service-role key after composing a post with "Send push notification"
// checked. Sends an Expo push to every registered token (batches of 100).
// Guarded by a service-role check — the public anon key passes the platform's
// verify_jwt but must NOT be able to trigger a broadcast.

import { adminClient, fetchAllRows, isServiceCaller } from "../_shared/client.ts";
import { excerptOrPhoto, pushCopy } from "../_shared/copy.ts";
import { sendExpoPushBatch } from "../_shared/push.ts";
import { BROADCAST_FALLBACK_TITLE } from "../_shared/config.ts";
import { ensureTranslations, resolveTargetLocale, TARGET_LOCALES } from "../_shared/translation.ts";

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
  const seen = new Set<string>();
  const messages = rows
    .map((r) => {
      const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return {
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
    })
    .map(({ to, locale, profileLocale }) => ({
      to,
      title,
      body: excerptFor(locale, profileLocale),
      data: { route: "/community", kind: "community_official_post", postId: post.id },
      badge: 1,
    }));
  await sendExpoPushBatch(messages);

  return new Response(JSON.stringify({ sent: messages.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
