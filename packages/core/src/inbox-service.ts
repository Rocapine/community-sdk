// Notification inbox service — every function is a thin wrapper around the
// injected Supabase client, gated on `cfg.modules.inbox` (the mutation/read
// pair below throw when the module is off, same pattern as
// setReaction/votePoll in service.ts; hooks additionally gate via `enabled`
// so a disabled module never even reaches these).
//
// Ported from a host app's notification-center service. Transformations:
// kind `prayer` -> `reaction` (the mold's generic reaction module, same
// prayer->reaction rename as the rest of this package); the `kind` union is
// widened with `(string & {})` so a custom service-role kind (that host's
// support-reply kind) passes through untouched instead of being special-cased
// here — the host UI decides what to do with a kind it doesn't recognize.

import type { ResolvedCommunityConfig } from "./config";
import { ensureIdentity } from "./identity";

export type InboxItem = {
  id: string;
  kind: "like" | "comment" | "reaction" | "official_post" | (string & {});
  createdAt: string;
  actorName: string | null;
  postId: string | null;
  payload: Record<string, unknown>;
};

export interface InboxState {
  items: InboxItem[];
  /** Everything at or before this instant is read; null = never opened. */
  seenAt: string | null;
}

/** Raw shape returned by the `list_notifications` RPC. */
interface NotificationRow {
  id: string;
  kind: string;
  actor_id: string | null;
  actor_username: string | null;
  post_id: string | null;
  post_excerpt: string | null;
  created_at: string;
}

const INBOX_PAGE_SIZE = 50;

async function requireUid(cfg: ResolvedCommunityConfig): Promise<string> {
  const uid = await ensureIdentity(cfg);
  if (!uid) throw new Error("You appear to be offline. Please try again.");
  return uid;
}

function mapKind(raw: string): InboxItem["kind"] {
  return raw === "prayer" ? "reaction" : raw;
}

function mapNotificationRow(row: NotificationRow): InboxItem {
  return {
    id: row.id,
    kind: mapKind(row.kind),
    createdAt: row.created_at,
    actorName: row.actor_username,
    postId: row.post_id,
    payload: { actorId: row.actor_id, postExcerpt: row.post_excerpt },
  };
}

/**
 * Move the seen marker past everything just read. Item timestamps are server
 * clocks and the device clock can lag them by minutes, so "now" alone would
 * leave the newest items permanently unread — take the max of both (mold
 * `seenMarkerFor`).
 */
function seenMarkerFor(latestItemCreatedAt: string | null | undefined): string {
  const latest = latestItemCreatedAt ? Date.parse(latestItemCreatedAt) : 0;
  return new Date(Math.max(Date.now(), Number.isNaN(latest) ? 0 : latest)).toISOString();
}

/** The inbox's whole state in one fetch: items (newest first) + seen marker. */
export async function fetchInbox(cfg: ResolvedCommunityConfig): Promise<InboxState> {
  if (!cfg.modules.inbox) throw new Error("inbox module is not enabled");
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const [listRes, seenRes] = await Promise.all([
    client.rpc("list_notifications", { p_limit: INBOX_PAGE_SIZE }),
    client.from("notification_seen").select("seen_at").eq("user_id", uid).maybeSingle(),
  ]);
  if (listRes.error) throw listRes.error;
  if (seenRes.error) throw seenRes.error;
  const items = ((listRes.data ?? []) as NotificationRow[]).map(mapNotificationRow);
  return { items, seenAt: (seenRes.data?.seen_at as string | undefined) ?? null };
}

/**
 * Marks everything currently in the inbox as read. The brief's signature
 * takes only `cfg` (unlike the mold's `markNotificationsSeen(latestItemCreatedAt)`),
 * so the clock-skew-safe anchor is derived internally: a cheap `list_notifications`
 * call for just the newest row, rather than dropping the guard or duplicating
 * the full `fetchInbox` (items + seen marker) round trip.
 */
export async function markInboxSeen(cfg: ResolvedCommunityConfig): Promise<void> {
  if (!cfg.modules.inbox) throw new Error("inbox module is not enabled");
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { data, error: listError } = await client.rpc("list_notifications", { p_limit: 1 });
  if (listError) throw listError;
  const latestCreatedAt = ((data ?? []) as NotificationRow[])[0]?.created_at ?? null;
  const { error } = await client
    .from("notification_seen")
    .upsert({ user_id: uid, seen_at: seenMarkerFor(latestCreatedAt) });
  if (error) throw error;
}

/** Unread = items strictly newer than the seen marker (all of them if never opened). Pure. */
export function unreadCount(items: InboxItem[], seenAt: string | null): number {
  if (!seenAt) return items.length;
  const seen = Date.parse(seenAt);
  return items.filter((item) => Date.parse(item.createdAt) > seen).length;
}
