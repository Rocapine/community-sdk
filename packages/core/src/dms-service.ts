// DMs backend service (dms module): start a DM, answer requests, the member's switch,
// read receipts and the "new message" picker. Writes go through the RPCs of
// dms/001_dms.sql; a raised code comes back as a `MessagingError`.

import { dmsSettings, type ResolvedCommunityConfig } from "./config";
import { callRpc } from "./messaging-service";
import { mapProfileRow, type CommunityProfile, type DmRequest, type ProfileRow } from "./models";
import { PROFILE_SELECT, requireUid } from "./service";

export const MEMBER_SEARCH_LIMIT = 20;

export function requireDms(cfg: ResolvedCommunityConfig): void {
  if (!cfg.modules.dms) throw new Error("dms module is not enabled");
}

async function dmsRpc<T>(
  cfg: ResolvedCommunityConfig,
  fn: string,
  args?: Record<string, unknown>,
): Promise<T> {
  requireDms(cfg);
  await requireUid(cfg);
  return callRpc<T>(cfg, fn, args);
}

/** Gets or creates my DM with `recipientId`; resolves to its conversation id. Refusals:
 * `dms_off`, `declined_recently`, `too_many_requests`, `blocked`, `account_required`,
 * `not_found`. */
export const startDm = (cfg: ResolvedCommunityConfig, recipientId: string) =>
  dmsRpc<string>(cfg, "start_dm", { p_recipient: recipientId });

export const acceptRequest = (cfg: ResolvedCommunityConfig, conversationId: string) =>
  dmsRpc<void>(cfg, "accept_request", { p_conversation: conversationId });

/** Silent: the sender is never told. */
export const declineRequest = (cfg: ResolvedCommunityConfig, conversationId: string) =>
  dmsRpc<void>(cfg, "decline_request", { p_conversation: conversationId });

/** Blocks the sender, reports their latest message and declines. */
export const blockAndReportRequest = (
  cfg: ResolvedCommunityConfig,
  conversationId: string,
  reason: "spam" | "harassment" | "hate" | "inappropriate" | "other",
) =>
  dmsRpc<void>(cfg, "block_and_report_request", {
    p_conversation: conversationId,
    p_reason: reason,
  });

/** My "Receive direct messages" switch: off blocks new DMs only. */
export const setAcceptsDms = (cfg: ResolvedCommunityConfig, on: boolean) =>
  dmsRpc<void>(cfg, "set_accepts_dms", { p_on: on });

type RequestRow = {
  conversation_id: string;
  sender_id: string;
  last_body: string | null;
  last_has_image: boolean;
  last_at: string;
  groups_in_common: number;
  common_group_names: string[] | null;
  member_since: string;
};

/** Requests waiting for my answer, newest first. */
export async function fetchDmRequests(cfg: ResolvedCommunityConfig): Promise<DmRequest[]> {
  const rows = await dmsRpc<RequestRow[] | null>(cfg, "list_dm_requests");
  return (rows ?? []).map((r) => ({
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    lastBody: r.last_body,
    lastHasImage: r.last_has_image,
    lastAt: r.last_at,
    groupsInCommon: r.groups_in_common,
    commonGroupNames: r.common_group_names ?? [],
    memberSince: r.member_since,
  }));
}

/** When the peer last read the DM ("Seen"), or null: read receipts off, a request,
 * a block. No query when the app turned read receipts off. */
export async function fetchPeerRead(
  cfg: ResolvedCommunityConfig,
  conversationId: string,
): Promise<string | null> {
  if (!dmsSettings(cfg)?.readReceipts) return null;
  return (
    (await dmsRpc<string | null>(cfg, "dm_peer_read", { p_conversation: conversationId })) ?? null
  );
}

type FlagRow = { user_id: string; accepts_dms: boolean; has_account: boolean };

const flagRows = async (cfg: ResolvedCommunityConfig, ids: string[]) =>
  (await dmsRpc<FlagRow[] | null>(cfg, "profile_dm_flags", { p_ids: ids })) ?? [];

/** Among `ids` (up to 200), the members I may start a DM with: they take DMs, have an
 * account when the app requires one, and no block stands between us (`profile_dm_flags`). */
export async function fetchDmFlags(cfg: ResolvedCommunityConfig, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const needsAccount = dmsSettings(cfg)?.requireAccount === true;
  return (await flagRows(cfg, ids))
    .filter((r) => r.accepts_dms && (r.has_account || !needsAccount))
    .map((r) => r.user_id);
}

/** My own "Receive direct messages" switch (the column isn't readable directly). */
export async function fetchAcceptsDms(cfg: ResolvedCommunityConfig): Promise<boolean> {
  requireDms(cfg);
  const uid = await requireUid(cfg);
  return (await flagRows(cfg, [uid]))[0]?.accepts_dms ?? true;
}

/** Members whose name contains `query`, for the "new message" picker: me, blocked
 * members (RLS) and those who don't take DMs left out. */
export async function searchMembers(
  cfg: ResolvedCommunityConfig,
  query: string,
): Promise<CommunityProfile[]> {
  requireDms(cfg);
  const cleaned = query.trim();
  if (!cleaned) return [];
  const uid = await requireUid(cfg);
  // Twice the page: some will drop out at the DM check below.
  // shortcut: banned members aren't readable client-side, so they can show (start_dm then
  // refuses `not_found`); filter server-side if a picker RPC ever lands.
  const { data, error } = await cfg
    .requireClient()
    .from("profiles")
    .select(PROFILE_SELECT)
    .ilike("username", `%${cleaned}%`)
    .neq("id", uid)
    .order("username")
    .limit(MEMBER_SEARCH_LIMIT * 2);
  if (error) throw error;
  const rows = (data ?? []) as unknown as ProfileRow[];
  const open = new Set(
    await fetchDmFlags(
      cfg,
      rows.map((r) => r.id),
    ),
  );
  return rows
    .filter((r) => open.has(r.id))
    .slice(0, MEMBER_SEARCH_LIMIT)
    .map((r) => mapProfileRow(r, cfg.authorFallback()));
}
