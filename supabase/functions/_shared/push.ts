// Shared Expo push sender. Used by notify-comment, notify-like,
// notify-reaction and broadcast-post (push module).

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

/** Unread inbox rows for `uid` (newer than the seen marker and not read one by one),
 * capped at 200, at least 1 since a push
 * is being sent. Falls back to 1 when the inbox module is not installed. */
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
    let query = supabase.from("notifications").select("id").eq("user_id", uid).limit(200);
    if (seen?.seen_at) query = query.gt("created_at", seen.seen_at);
    const { data: rows, error } = await query;
    if (error) return 1;
    const ids = (rows ?? []).map((r: { id: string }) => r.id);
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
