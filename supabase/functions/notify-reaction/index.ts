// Coalesced reaction notifications (generic "I stand with you" reaction — see
// supabase/migrations/reaction/001_reactions.sql; the reaction's *meaning* is
// 100% client-side, this function only sends the push). Trigger path (body
// has record): 10-min per-post cooldown. Digest path (no record, from cron):
// sweep posts with unnotified reactions older than the cooldown. Never
// includes any reaction content — the reaction table carries no text.
//
// Push copy: the recipient's profiles.locale selects a built-in neutral
// template for the common single-reactor case (COMMUNITY_REACTION_PUSH_TEXT
// overrides that template for every locale, `{name}` substituted with the
// reactor's display name — an app with its own reaction semantics sets its
// own copy there). The multi-reactor case always uses the locale's own
// "and N others" phrasing; there is no secret for it, only the built-in
// translations below.
//
// NOTE: profiles.locale is not part of the SDK's core schema yet (task 16) —
// it must exist before this function can run. See the internal port notes
// for a reference migration adding it.

import { adminClient } from "../_shared/client.ts";
import { sendExpoPush } from "../_shared/push.ts";
import { FALLBACK_ACTOR_NAME, REACTION_PUSH_TEXT } from "../_shared/config.ts";

const supabase = adminClient();
const COOLDOWN_MS = 10 * 60 * 1000;

/**
 * CLDR plural form for a count: 1 -> `one`, 2-4 -> `few`, 5+ -> `many` (the
 * Polish rule, minus the fractional `other` case a push count never hits).
 * Every other locale below needs only a singular/plural pair.
 */
function plForm(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const lastTwo = n % 100;
  const inTeens = lastTwo >= 10 && lastTwo < 20;
  return !inTeens && n % 10 >= 2 && n % 10 <= 4 ? few : many;
}

// Built-in neutral push copy per recipient locale (profiles.locale). Keys
// mirror SupportedLanguage in host apps; unknown locales fall back to en.
// `one` is only used when COMMUNITY_REACTION_PUSH_TEXT is unset (its default
// already matches the `en` entry below).
const COPY = {
  en: {
    fallbackName: "Someone",
    one: (name: string) => `${name} is thinking of you`,
    many: (name: string, extra: number) =>
      `${name} and ${extra} ${extra === 1 ? "other" : "others"} are thinking of you`,
  },
  "pt-PT": {
    fallbackName: "Alguém",
    one: (name: string) => `${name} está a pensar em ti`,
    many: (name: string, extra: number) =>
      `${name} e mais ${extra} ${extra === 1 ? "pessoa está" : "pessoas estão"} a pensar em ti`,
  },
  "pt-BR": {
    fallbackName: "Alguém",
    one: (name: string) => `${name} está pensando em você`,
    many: (name: string, extra: number) =>
      `${name} e mais ${extra} ${extra === 1 ? "pessoa está" : "pessoas estão"} pensando em você`,
  },
  "es-ES": {
    fallbackName: "Alguien",
    one: (name: string) => `${name} está pensando en ti`,
    many: (name: string, extra: number) =>
      `${name} y ${extra} ${extra === 1 ? "persona más está" : "personas más están"} pensando en ti`,
  },
  "es-419": {
    fallbackName: "Alguien",
    one: (name: string) => `${name} está pensando en ti`,
    many: (name: string, extra: number) =>
      `${name} y ${extra} ${extra === 1 ? "persona más está" : "personas más están"} pensando en ti`,
  },
  it: {
    fallbackName: "Qualcuno",
    one: (name: string) => `${name} sta pensando a te`,
    many: (name: string, extra: number) =>
      `${name} e altre ${extra} ${extra === 1 ? "persona sta" : "persone stanno"} pensando a te`,
  },
  pl: {
    fallbackName: "Ktoś",
    one: (name: string) => `${name} myśli o tobie`,
    many: (name: string, extra: number) =>
      `${name} i ${plForm(extra, `${extra} inna osoba myśli`, `${extra} inne osoby myślą`, `${extra} innych osób myśli`)} o tobie`,
  },
} as const;

function copyFor(locale: string | null | undefined) {
  return COPY[(locale ?? "en") as keyof typeof COPY] ?? COPY.en;
}

async function flushPost(postId: string) {
  const { data: post } = await supabase.from("posts").select("author_id").eq("id", postId).single();
  if (!post) return;

  const { data: recipient } = await supabase
    .from("profiles")
    .select("locale")
    .eq("id", post.author_id)
    .single();
  const copy = copyFor(recipient?.locale);

  const { data: pref } = await supabase
    .from("push_tokens")
    .select("expo_push_token, notify_reactions")
    .eq("user_id", post.author_id)
    .single();

  const { data: unnotified } = await supabase
    .from("post_reactions")
    .select("user_id, created_at")
    .eq("post_id", postId)
    .is("notified_at", null)
    .order("created_at", { ascending: false });
  if (!unnotified || unnotified.length === 0) return;

  const now = new Date().toISOString();
  await supabase
    .from("post_reactions")
    .update({ notified_at: now })
    .eq("post_id", postId)
    .is("notified_at", null);

  if (!pref?.expo_push_token || !pref.notify_reactions) return;

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
  // COMMUNITY_FALLBACK_NAME (the deployer-set env var, shared with
  // notify-like/notify-comment and meant to match the client's
  // anonymousAuthorFallback — see docs/backend-runbook.md) takes precedence
  // over the locale table's own fallbackName default.
  const name = actor?.username?.trim() || FALLBACK_ACTOR_NAME || copy.fallbackName;
  const title =
    contributors.length === 1
      ? REACTION_PUSH_TEXT.replace("{name}", name)
      : copy.many(name, contributors.length - 1);

  await sendExpoPush({
    to: pref.expo_push_token,
    title,
    data: { route: "/community", kind: "community_reaction" },
    badge: 1,
  });
}

Deno.serve(async (req) => {
  const payload = (await req.json().catch(() => ({}))) as {
    record?: { post_id: string };
  };

  if (payload.record?.post_id) {
    const postId = payload.record.post_id;
    const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const { count } = await supabase
      .from("post_reactions")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId)
      .gt("notified_at", since);
    if ((count ?? 0) > 0) return new Response("hold: cooldown");
    await flushPost(postId);
    return new Response("ok");
  }

  const cutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data: stale } = await supabase
    .from("post_reactions")
    .select("post_id")
    .is("notified_at", null)
    .lt("created_at", cutoff);
  const postIds = [...new Set((stale ?? []).map((r) => r.post_id as string))];
  for (const pid of postIds) await flushPost(pid);
  return new Response(JSON.stringify({ swept: postIds.length }));
});
