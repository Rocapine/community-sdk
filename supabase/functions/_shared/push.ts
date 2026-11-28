// Shared Expo push sender. Used by notify-comment, notify-like,
// notify-reaction, notify-message and broadcast-post (push module).

import { blockedWith } from "./blocks.ts";
import { runPool } from "./translation.ts";

export interface ExpoPushMessage {
  to: string;
  // Left out, the OS shows the app's name (a DM request push).
  title?: string;
  body?: string;
  data: Record<string, string>;
  // The recipient's unread inbox items plus followed messages at send time (see
  // `unreadBadge`); the app re-syncs the icon badge from the SDK's own count while it runs.
  badge?: number;
  // Group pushes of one conversation (iOS thread) and replace the shown one (iOS collapse).
  threadId?: string;
  collapseId?: string;
}

/** Per invocation: set once `unread_followed_messages_for` turns out not to exist (no
 * messaging module), so the following badges of the same call skip it. */
export type BadgeState = { followedMessagesMissing?: boolean };

/** The app-icon badge for `uid`: unread inbox items plus the unread messages of the
 * groups they follow (messaging/002_push.sql), at least 1 since a push is being sent.
 * Either part counts 0 when its module is not installed or its query fails. */
export async function unreadBadge(
  supabase: { from: (table: string) => any; rpc?: (fn: string, args: object) => any },
  uid: string,
  state: BadgeState = {},
): Promise<number> {
  const [inbox, messages] = await Promise.all([
    unreadInbox(supabase, uid),
    unreadFollowedMessages(supabase, uid, state),
  ]);
  return Math.max(1, inbox + messages);
}

// Undefined function: Postgres 42883 or PostgREST's PGRST202.
const isMissingFunction = (code: unknown) => code === "42883" || code === "PGRST202";

async function unreadFollowedMessages(
  supabase: { rpc?: (fn: string, args: object) => any },
  uid: string,
  state: BadgeState,
): Promise<number> {
  if (state.followedMessagesMissing || !supabase.rpc) return 0;
  try {
    const { data, error } = await supabase.rpc("unread_followed_messages_for", { p_uid: uid });
    if (error && isMissingFunction(error.code)) state.followedMessagesMissing = true;
    return !error && typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}

/** Unread inbox items for `uid`, counted like the app's `unreadCount`: notification
 * rows (minus those from a member blocked either way) and admin posts sent to
 * everyone, newer than the seen marker and not read one by one. Capped at 200.
 * 0 when the inbox module is not installed. */
async function unreadInbox(
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
    if (error) return 0;
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
    if (ids.length === 0) return 0;
    // Items marked read one by one (inbox/002_replies_and_reads.sql); a project
    // without that table just counts every row past the watermark.
    const { data: reads } = await supabase
      .from("notification_reads")
      .select("item_id")
      .eq("user_id", uid)
      .in("item_id", ids);
    return Math.max(0, ids.length - (reads?.length ?? 0));
  } catch {
    return 0;
  }
}

/** `unreadBadge` for each distinct user, `concurrency` at a time (broadcast-post). The
 * first user goes alone: it finds out whether `unread_followed_messages_for` exists,
 * so a host without messaging makes one failing call per run, not one per worker.
 * shortcut: 5 queries per user, fine for a few thousand members; past ~20k, move
 * the count into one SQL function per page. */
export async function unreadBadges(
  supabase: { from: (table: string) => any; rpc?: (fn: string, args: object) => any },
  uids: string[],
  concurrency = 20,
): Promise<Map<string, number>> {
  const badges = new Map<string, number>();
  const state: BadgeState = {};
  const [first, ...rest] = [...new Set(uids)];
  if (first === undefined) return badges;
  badges.set(first, await unreadBadge(supabase, first, state));
  await runPool(rest, concurrency, async (uid) => {
    badges.set(uid, await unreadBadge(supabase, uid, state));
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
): Promise<{ invalidTokens: string[] }> {
  const invalidTokens: string[] = [];
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
      // Tickets come back in message order; a lone message answers with an object.
      const parsed = JSON.parse(body || "{}") as { data?: unknown };
      const tickets = Array.isArray(parsed.data) ? parsed.data : parsed.data ? [parsed.data] : [];
      tickets.forEach((t: { status?: string; details?: { error?: string } }, i) => {
        if (t?.status === "error" && t.details?.error === "DeviceNotRegistered") {
          if (chunk[i]) invalidTokens.push(chunk[i].to);
        }
      });
    } catch (error) {
      console.error("expo push: request failed", error);
    }
  });
  return { invalidTokens };
}

export async function sendExpoPush(message: ExpoPushMessage): Promise<{ invalidTokens: string[] }> {
  return await sendExpoPushBatch([message]);
}

/** Every token a member can be pushed on: `push_devices` (one per device) plus the legacy
 * single `push_tokens` token, de-duplicated. Prefs come from `push_tokens` (true without a row).
 * A project without `push_devices` yet just has the legacy token. */
export async function recipientTokens(
  supabase: { from: (table: string) => any },
  userId: string,
): Promise<{ tokens: string[]; prefs: { notify_likes: boolean; notify_comments: boolean } }> {
  const { data: devices } = await supabase
    .from("push_devices")
    .select("expo_push_token")
    .eq("user_id", userId);
  const { data: legacy } = await supabase
    .from("push_tokens")
    .select("expo_push_token, notify_likes, notify_comments")
    .eq("user_id", userId)
    .maybeSingle();
  const tokens = [
    ...new Set(
      [
        ...(devices ?? []).map((d: { expo_push_token: string }) => d.expo_push_token),
        legacy?.expo_push_token,
      ].filter((t): t is string => !!t),
    ),
  ];
  return {
    tokens,
    prefs: {
      notify_likes: legacy?.notify_likes ?? true,
      notify_comments: legacy?.notify_comments ?? true,
    },
  };
}

/** Forget tokens Expo says are gone: delete their device rows, null the legacy one. */
export async function dropInvalidTokens(
  supabase: { from: (table: string) => any },
  invalidTokens: string[],
): Promise<void> {
  // Chunked: the tokens travel in the URL, and a long list would exceed PostgREST's limit.
  for (let i = 0; i < invalidTokens.length; i += 100) {
    const chunk = invalidTokens.slice(i, i + 100);
    const results = [
      await supabase.from("push_devices").delete().in("expo_push_token", chunk),
      await supabase
        .from("push_tokens")
        .update({ expo_push_token: null })
        .in("expo_push_token", chunk),
    ];
    for (const { error } of results) {
      if (error) console.error("expo push: pruning dead tokens failed", error.message);
    }
  }
}
