// Groups backend service: create, edit, join, leave, manage members, search.
// Writes go through the RPCs of groups/001_groups.sql. The `groups` table hides
// pending_* and rejected_fields from clients (column grants): every select names
// its columns, and the creator's review data comes from `my_group_review`.

import type { ResolvedCommunityConfig } from "./config";
import { readerLocale } from "./locale";
import {
  GROUP_IMAGES_BUCKET,
  callRpc,
  groupImageUrl as publicImageUrl,
  requireGroups,
  toGroupStatus,
  uploadJpeg,
  uuid,
} from "./messaging-service";
import type { Group } from "./models";
import { moderateOne, requireUid } from "./service";

export { GROUP_IMAGES_BUCKET };
export const GROUP_IMAGES_PENDING_BUCKET = "group-images-pending";
export const GROUPS_PAGE_SIZE = 30;
export const GROUP_MEMBERS_PAGE_SIZE = 50;

export type GroupMember = { userId: string; role: "member" | "creator"; joinedAt: string };

const GROUP_COLUMNS =
  "conversation_id, name, description, image_path, status, created_by, member_count, last_activity_at";

/** Uploads a new group image to the caller's pending folder; moderation moves it. */
async function uploadPendingImage(cfg: ResolvedCommunityConfig, uid: string, uri: string) {
  const path = `${uid}/${uuid()}.jpg`;
  await uploadJpeg(cfg, GROUP_IMAGES_PENDING_BUCKET, path, uri);
  return path;
}

/** Creates a group (pending until moderation approves it) and moderates it. Returns its id. */
export async function createGroup(
  cfg: ResolvedCommunityConfig,
  input: { name: string; description: string; imageUri?: string },
): Promise<string> {
  requireGroups(cfg);
  const uid = await requireUid(cfg);
  const imagePath = input.imageUri ? await uploadPendingImage(cfg, uid, input.imageUri) : null;
  const id = await callRpc<string>(cfg, "create_group", {
    p_name: input.name,
    p_description: input.description,
    p_image_path: imagePath,
  });
  await moderateOne(cfg, { kind: "group", id });
  return id;
}

/** Submits new values (an absent field stays as it is), then moderates them. */
export async function editGroup(
  cfg: ResolvedCommunityConfig,
  groupId: string,
  input: { name?: string; description?: string; imageUri?: string },
): Promise<void> {
  requireGroups(cfg);
  const uid = await requireUid(cfg);
  const imagePath = input.imageUri ? await uploadPendingImage(cfg, uid, input.imageUri) : null;
  await callRpc(cfg, "edit_group", {
    p_group: groupId,
    p_name: input.name ?? null,
    p_description: input.description ?? null,
    p_image_path: imagePath,
  });
  await moderateOne(cfg, { kind: "group", id: groupId });
}

async function groupRpc(cfg: ResolvedCommunityConfig, fn: string, args: Record<string, unknown>) {
  requireGroups(cfg);
  await requireUid(cfg);
  await callRpc(cfg, fn, args);
}

export const deleteGroup = (cfg: ResolvedCommunityConfig, groupId: string) =>
  groupRpc(cfg, "delete_group", { p_group: groupId });
export const joinGroup = (cfg: ResolvedCommunityConfig, groupId: string) =>
  groupRpc(cfg, "join_group", { p_group: groupId });
export const leaveGroup = (cfg: ResolvedCommunityConfig, groupId: string) =>
  groupRpc(cfg, "leave_group", { p_group: groupId });
export const removeMember = (cfg: ResolvedCommunityConfig, groupId: string, userId: string) =>
  groupRpc(cfg, "remove_member", { p_group: groupId, p_user: userId });
export const readmitMember = (cfg: ResolvedCommunityConfig, groupId: string, userId: string) =>
  groupRpc(cfg, "readmit_member", { p_group: groupId, p_user: userId });
export const setGroupNotify = (cfg: ResolvedCommunityConfig, groupId: string, notify: boolean) =>
  groupRpc(cfg, "set_group_notify", { p_group: groupId, p_notify: notify });

type SearchRow = {
  group_id: string;
  name: string;
  description: string;
  image_path: string | null;
  member_count: number;
  last_activity_at: string;
  is_member: boolean;
};

/** Visible groups, latest activity first, in the reader's locale when translated.
 * `before`: the last group of the previous page (keyset cursor). */
export async function searchGroups(
  cfg: ResolvedCommunityConfig,
  opts: { query?: string; before?: { id: string; lastActivityAt: string } } = {},
): Promise<Group[]> {
  requireGroups(cfg);
  const uid = await requireUid(cfg);
  const rows = await callRpc<SearchRow[]>(cfg, "search_groups", {
    p_query: opts.query?.trim() || null,
    p_locale: readerLocale(cfg),
    p_limit: GROUPS_PAGE_SIZE,
    // Both cursor values or neither: the RPC compares the pair.
    ...(opts.before
      ? { p_before_activity: opts.before.lastActivityAt, p_before_id: opts.before.id }
      : {}),
  });
  if (!rows?.length) return [];
  // search_groups doesn't return the creator: one look-up of mine among the page.
  const { data, error } = await cfg
    .requireClient()
    .from("groups")
    .select("conversation_id")
    .eq("created_by", uid)
    .in(
      "conversation_id",
      rows.map((r) => r.group_id),
    );
  if (error) throw error;
  const mine = new Set((data ?? []).map((g) => (g as { conversation_id: string }).conversation_id));
  return rows.map((r) => ({
    id: r.group_id,
    name: r.name,
    description: r.description,
    imageUrl: publicImageUrl(cfg, r.image_path),
    memberCount: r.member_count,
    lastActivityAt: r.last_activity_at,
    isMember: r.is_member,
    status: "visible",
    rejectedFields: [],
    isCreator: mine.has(r.group_id),
    myRole: null,
    creatorId: null,
    removed: false,
  }));
}

type GroupRow = {
  conversation_id: string;
  name: string | null;
  description: string | null;
  image_path: string | null;
  status: "pending" | "visible" | "hidden" | "deleted";
  created_by: string | null;
  member_count: number;
  last_activity_at: string;
  group_translations?: { name: string | null; description: string | null }[];
};

type ReviewRow = {
  pending_name: string | null;
  pending_description: string | null;
  pending_image_path: string | null;
  rejected_fields: string[];
  status: string;
};

/** One group, or null when it is unreadable or deleted. Its creator also gets the
 * review state, and the pending values while nothing is approved yet. */
export async function fetchGroup(cfg: ResolvedCommunityConfig, id: string): Promise<Group | null> {
  requireGroups(cfg);
  const uid = await requireUid(cfg);
  const client = cfg.requireClient();
  const locale = readerLocale(cfg);
  let query = client
    .from("groups")
    .select(locale ? `${GROUP_COLUMNS}, group_translations(name, description)` : GROUP_COLUMNS)
    .eq("conversation_id", id);
  if (locale) query = query.eq("group_translations.locale", locale);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  const g = data as unknown as GroupRow | null;
  if (!g || g.status === "deleted") return null;

  const isCreator = g.created_by === uid;
  const [membership, review] = await Promise.all([
    client
      .from("conversation_members")
      .select("state, role")
      .eq("conversation_id", id)
      .eq("user_id", uid)
      .maybeSingle(),
    isCreator ? callRpc<ReviewRow[]>(cfg, "my_group_review", { p_group: id }) : null,
  ]);
  if (membership.error) throw membership.error;
  const member = membership.data as { state: string; role: "member" | "creator" } | null;
  const active = member?.state === "active";
  const r = review?.[0];
  const t = g.group_translations?.[0];
  let imageUrl = publicImageUrl(cfg, g.image_path);
  if (!imageUrl && r?.pending_image_path) {
    const signed = await client.storage
      .from(GROUP_IMAGES_PENDING_BUCKET)
      .createSignedUrl(r.pending_image_path, 3600);
    imageUrl = signed.data?.signedUrl ?? null;
  }
  return {
    id: g.conversation_id,
    // Live values (approved) win; a never-approved group shows its creator the pending ones.
    name: t?.name ?? g.name ?? r?.pending_name ?? "",
    description: t?.description ?? g.description ?? r?.pending_description ?? "",
    imageUrl,
    memberCount: g.member_count,
    lastActivityAt: g.last_activity_at,
    isMember: active,
    // R13: hidden by a moderator stays "hidden" (never "pending": no approval is coming).
    status: toGroupStatus(g.status) ?? "pending",
    rejectedFields: r?.rejected_fields ?? [],
    isCreator,
    myRole: active ? (member?.role ?? "member") : null,
    creatorId: g.created_by,
    removed: member?.state === "removed",
  };
}

/** Active members, the creator first (members only). */
export async function fetchGroupMembers(
  cfg: ResolvedCommunityConfig,
  id: string,
  opts: { query?: string; offset?: number } = {},
): Promise<GroupMember[]> {
  requireGroups(cfg);
  await requireUid(cfg);
  const rows = await callRpc<{ user_id: string; role: "member" | "creator"; joined_at: string }[]>(
    cfg,
    "list_conversation_members",
    {
      p_conversation: id,
      p_query: opts.query?.trim() || null,
      p_limit: GROUP_MEMBERS_PAGE_SIZE,
      p_offset: opts.offset ?? 0,
    },
  );
  return (rows ?? []).map((r) => ({ userId: r.user_id, role: r.role, joinedAt: r.joined_at }));
}

/** Online members per group; empty when the presence module is off. */
export async function fetchGroupOnlineCounts(
  cfg: ResolvedCommunityConfig,
  ids: string[],
): Promise<Record<string, number>> {
  requireGroups(cfg);
  if (!cfg.modules.presence || ids.length === 0) return {};
  await requireUid(cfg);
  const rows = await callRpc<{ group_id: string; online: number }[]>(cfg, "group_online_counts", {
    p_groups: ids,
  });
  return Object.fromEntries((rows ?? []).map((r) => [r.group_id, r.online]));
}

export type GroupRemoval = { userId: string; username: string | null; removedAt: string };

/** Members removed from a group, latest first (its managers only, RLS). `query` keeps
 * those whose username contains it, as the member search does. */
export async function fetchGroupRemovals(
  cfg: ResolvedCommunityConfig,
  id: string,
  query = "",
): Promise<GroupRemoval[]> {
  requireGroups(cfg);
  await requireUid(cfg);
  const { data, error } = await cfg
    .requireClient()
    .from("group_removals")
    .select("user_id, removed_at, profiles(username)")
    .eq("group_id", id)
    .order("removed_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const q = query.trim().toLowerCase();
  return (
    (data ?? []) as unknown as {
      user_id: string;
      removed_at: string;
      profiles: { username: string | null } | null;
    }[]
  )
    .map((r) => ({
      userId: r.user_id,
      username: r.profiles?.username ?? null,
      removedAt: r.removed_at,
    }))
    .filter((r) => !q || (r.username ?? "").toLowerCase().includes(q));
}
