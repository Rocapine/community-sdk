// Shared Expo push sender. Used by notify-comment, notify-like,
// notify-reaction and broadcast-post (push module).

import { blockedWith } from "./blocks.ts";
import { runPool } from "./translation.ts";

export interface ExpoPushMessage {
  to: string;
  title: string;
  body?: string;
  data: Record<string, string>;
  // The recipient's unread inbox count at send time (see `unreadBadge`); the
  // app re-syncs the icon badge from the SDK's own count while it runs.
  badge?: number;
}

/** Unread inbox items for `uid`, counted like the app's `unreadCount`: notification
 * rows (minus those from a member blocked either way) and admin posts sent to
 * everyone, newer than the seen marker and not read one by one. Capped at 200, at
 * least 1 since a push is being sent. Falls back to 1 when the inbox module is not installed. */
export async function unreadBadge(
  supabase: { from: (table: string) => any },
  uid: string,
): Promise<number> {
  try {
    const { data: seen } = await supabase
      .from("notification_seen")
      .select("seen_at")
      .eq("user_id", uid)
      .maybeSingle();
    let query = supabase.from("notifications").select("id, actor_id").eq("user_id", uid).limit(200);
    if (seen?.seen_at) query = query.gt("created_at", seen.seen_at);
    const { data: rows, error } = await query;
    if (error) return 1;
    // Admin posts sent to everyone are listed in the center too, for 90 days
    // (inbox/003_pushed_admin_posts.sql); a broadcast counts the post it sends.
    const since = Math.max(
      seen?.seen_at ? Date.parse(seen.seen_at) : 0,
      Date.now() - 90 * 24 * 3600 * 1000,
    );
    const { data: official } = await supabase
      .from("posts")
      .select("id")
      .eq("status", "visible")
      .neq("author_id", uid)
      .gt("broadcast_at", new Date(since).toISOString())
      .limit(200);
    // Notification rows follow the same block rule as list_notifications
    // (inbox/004_mutual_blocks.sql); admins are never hidden by a block.
    const hidden = await blockedWith(supabase, uid);
    const own = ((rows ?? []) as { id: string; actor_id: string | null }[]).filter(
      (r) => !r.actor_id || !hidden.has(r.actor_id),
    );
    const ids = [...own, ...(official ?? [])].map((r: { id: string }) => r.id).slice(0, 200);
    if (ids.length === 0) return 1;
    // Items marked read one by one (inbox/002_replies_and_reads.sql); a project
    // without that table just counts every row past the watermark.
    const { data: reads } = await supabase
      .from("notification_reads")
      .select("item_id")
      .eq("user_id", uid)
      .in("item_id", ids);
    return Math.max(1, ids.length - (reads?.length ?? 0));
  } catch {
    return 1;
  }
}

/** `unreadBadge` for each distinct user, `concurrency` at a time (broadcast-post).
 * shortcut: 4 queries per user, fine for a few thousand members; past ~20k, move
 * the count into one SQL function per page. */
export async function unreadBadges(
  supabase: { from: (table: string) => any },
  uids: string[],
  concurrency = 20,
): Promise<Map<string, number>> {
  const badges = new Map<string, number>();
  await runPool([...new Set(uids)], concurrency, async (uid) => {
    badges.set(uid, await unreadBadge(supabase, uid));
  });
  return badges;
}

// Sends in chunks of 100 (Expo API limit), 4 requests in flight at a time, each
// aborted after 10 s so one hung request can't stall a large broadcast past the
// function's wall-clock limit. Best-effort: push failures must never fail the
// calling webhook. Projects with Enhanced Security for push must set the
// EXPO_ACCESS_TOKEN function secret. `fetchImpl`/`concurrency` are for tests.
export async function sendExpoPushBatch(
  messages: ExpoPushMessage[],
  opts: { fetchImpl?: typeof fetch; concurrency?: number } = {},
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const chunks: ExpoPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));
  await runPool(chunks, opts.concurrency ?? 4, async (chunk) => {
    try {
      const res = await fetchImpl("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers,
        body: JSON.stringify(chunk.length === 1 ? chunk[0] : chunk),
        signal: AbortSignal.timeout(10_000),
      });
      // Best effort, but never silent: a project with push security enabled
      // answers 401 UNAUTHORIZED without EXPO_ACCESS_TOKEN, and bad tokens
      // come back as per-message tickets — both used to vanish here.
      const body = await res.text();
      if (!res.ok || /"status"\s*:\s*"error"/.test(body)) {
        console.error(`expo push: HTTP ${res.status} ${body.slice(0, 500)}`);
      }
    } catch (error) {
      console.error("expo push: request failed", error);
    }
  });
}

export async function sendExpoPush(message: ExpoPushMessage): Promise<void> {
  await sendExpoPushBatch([message]);
}
