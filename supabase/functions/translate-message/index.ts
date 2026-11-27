// On-demand translation of one chat message into one locale, for the caller.
// Requires a user JWT. The message is read with the CALLER's client, so RLS
// (conversation readable, not blocked, visible or own) proves read access
// before anything is translated; only then does the service role read the
// cache and write it. Cached in message_translations (dropped when the
// message is edited or deleted).
//
// Body: { messageId: string, locale: string } -> { body: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { adminClient, callerUserId, json, preflight, SUPABASE_URL } from "../_shared/client.ts";
import { ENGINE, TARGET_LOCALES, translateItem } from "../_shared/translation.ts";

const supabase = adminClient();

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const { messageId, locale } = (await req.json().catch(() => ({}))) as {
    messageId?: unknown;
    locale?: unknown;
  };
  if (typeof messageId !== "string" || typeof locale !== "string") {
    return json({ error: "bad request" }, 400);
  }
  if (!TARGET_LOCALES.includes(locale)) return json({ error: "unsupported locale" }, 400);
  if (!(await callerUserId(req))) return json({ error: "unauthorized" }, 401);

  const { data: settings } = await supabase
    .from("messaging_settings")
    .select("settings")
    .eq("id", 1)
    .maybeSingle();
  if ((settings?.settings as { translation?: string } | null)?.translation === "off") {
    return json({ error: "translation off" }, 403);
  }

  const caller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("authorization")! } },
  });
  const { data: msg } = await caller
    .from("messages")
    .select("body, status")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || msg.status !== "visible" || !msg.body?.trim()) {
    return json({ error: "not found" }, 404);
  }

  const { data: cached } = await supabase
    .from("message_translations")
    .select("body")
    .eq("message_id", messageId)
    .eq("locale", locale)
    .maybeSingle();
  if (cached) return json({ body: cached.body });

  const parsed = await translateItem({ content: msg.body, options: [], targets: [locale] });
  if (!parsed) return json({ error: "translation failed" }, 502);
  // A message already in the target language is cached as is: one call, not one per view.
  const body = parsed.translations[locale]?.content ?? msg.body;

  // Edited meanwhile: the translation belongs to the old text, return it without caching.
  const { data: now } = await supabase.from("messages").select("body").eq("id", messageId).single();
  if (now?.body === msg.body) {
    const { error } = await supabase
      .from("message_translations")
      .upsert(
        { message_id: messageId, locale, body, engine: ENGINE },
        { onConflict: "message_id,locale", ignoreDuplicates: true },
      );
    if (error) console.error("message translation cache write failed", error.message);
  }
  return json({ body });
});
