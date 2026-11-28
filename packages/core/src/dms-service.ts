// DMs backend service (dms module): start a DM, answer requests, the member's switch,
// read receipts and the "new message" picker. Writes go through the RPCs of
// dms/001_dms.sql; a raised code comes back as a `MessagingError`.

import { dmsSettings, type ResolvedCommunityConfig } from "./config";
import { callRpc } from "./messaging-service";
import { mapProfileRow, type CommunityProfile, type DmRequest } from "./models";
import { requireUid } from "./service";

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

type FlagRow = { user_id: string; accepts_dms: boolean; has_account: boolean; has_dm: boolean };

const flagRows = async (cfg: ResolvedCommunityConfig, ids: string[]) =>
  (await dmsRpc<FlagRow[] | null>(cfg, "profile_dm_flags", { p_ids: ids })) ?? [];

/** Among `ids` (up to 200), the members I may message: an existing DM opens whatever
 * their switch says; a new one needs them to take DMs and, when the app requires it, an
 * account. Blocked (either way) and banned members have no row (`profile_dm_flags`). */
export async function fetchDmFlags(cfg: ResolvedCommunityConfig, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const needsAccount = dmsSettings(cfg)?.requireAccount === true;
  return (await flagRows(cfg, ids))
    .filter((r) => r.has_dm || (r.accepts_dms && (r.has_account || !needsAccount)))
    .map((r) => r.user_id);
}

/** My own "Receive direct messages" switch (the column isn't readable directly). */
export async function fetchAcceptsDms(cfg: ResolvedCommunityConfig): Promise<boolean> {
  requireDms(cfg);
  const uid = await requireUid(cfg);
  // No row only when my profile isn't there yet: the column's default is true.
  return (await flagRows(cfg, [uid]))[0]?.accepts_dms ?? true;
}

type MemberRow = { user_id: string; username: string | null; avatar_url: string | null };

/** Members whose name contains `query`, for the "new message" picker: those I may
 * message, never me, nor banned or blocked members (`search_dm_members`). */
export async function searchMembers(
  cfg: ResolvedCommunityConfig,
  query: string,
): Promise<CommunityProfile[]> {
  const cleaned = query.trim();
  requireDms(cfg);
  if (!cleaned) return [];
  const rows = await dmsRpc<MemberRow[] | null>(cfg, "search_dm_members", {
    p_query: cleaned,
    p_limit: MEMBER_SEARCH_LIMIT,
  });
  return (rows ?? []).map((r) =>
    mapProfileRow(
      {
        id: r.user_id,
        username: r.username,
        avatar_url: r.avatar_url,
        handle: null,
        is_admin: null,
        bio: null,
      },
      cfg.authorFallback(),
    ),
  );
}
