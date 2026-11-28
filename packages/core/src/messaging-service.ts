// Messaging backend service (groups and dms modules): conversations and
// messages. Every write goes through the security definer RPCs of
// messaging/001_messaging.sql; reads go through RLS. Postgres errors raised by
// those RPCs come back as `MessagingError` with the raised code.

import type { PostgrestError } from "@supabase/supabase-js";

import { attachmentTypeAllowed, messagingSettings, type ResolvedCommunityConfig } from "./config";
import type { ChatMessage, Conversation, GroupStatus, PostAttachment } from "./models";
import { moderateOne, requireUid } from "./service";
import { cacheSignedUrl, cachedSignedUrl } from "./signed-urls";

export const MESSAGE_IMAGES_BUCKET = "message-images";
export const MESSAGES_PAGE_SIZE = 40;

/** Every code the messaging, groups and dms RPCs raise. */
export const MESSAGING_ERROR_CODES = [
  "account_required",
  "banned",
  "blocked",
  "declined_recently",
  "description_required",
  "description_too_long",
  "dms_off",
  "empty_message",
  "forbidden",
  "group_full",
  "invalid_attachment",
  "invalid_image_path",
  "invalid_reason",
  "invalid_recipient",
  "invalid_reply",
  "message_too_long",
  "name_required",
  "name_too_long",
  "not_a_group",
  "not_a_member",
  "not_authenticated",
  "not_editable",
  "not_found",
  "rate_limited",
  "removed_from_group",
  "too_many_groups",
  "too_many_joined",
  "too_many_requests",
] as const;

export type MessagingErrorCode = (typeof MESSAGING_ERROR_CODES)[number] | "unknown";

export class MessagingError extends Error {
  readonly code: MessagingErrorCode;
  /** The original PostgREST / network error. */
  readonly cause?: unknown;
  constructor(code: MessagingErrorCode, message?: string, cause?: unknown) {
    super(message ?? code);
    this.name = "MessagingError";
    this.code = code;
    this.cause = cause;
  }
}

/** A raised exception reaches the client as `{ code: "P0001", message: "<code>" }`. */
export function toMessagingError(error: PostgrestError | Error): MessagingError {
  const raised = (MESSAGING_ERROR_CODES as readonly string[]).includes(error.message);
  return new MessagingError(
    raised ? (error.message as MessagingErrorCode) : "unknown",
    error.message,
    error,
  );
}

/** Runs an RPC, throwing a `MessagingError` on failure. */
export async function callRpc<T>(
  cfg: ResolvedCommunityConfig,
  fn: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await cfg.requireClient().rpc(fn, args);
  if (error) throw toMessagingError(error);
  return data as T;
}

export function requireGroups(cfg: ResolvedCommunityConfig): void {
  if (!cfg.modules.groups) throw new Error("groups module is not enabled");
}

export function requireMessaging(cfg: ResolvedCommunityConfig): void {
  if (!messagingSettings(cfg)) throw new Error("messaging is not enabled (groups or dms module)");
}

/** A v4 uuid; storage paths require one (Hermes may lack `crypto.randomUUID`). */
export function uuid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    })
  );
}

/** Uploads a local image (re-encoded to JPEG by the picker, like post images). */
export async function uploadJpeg(
  cfg: ResolvedCommunityConfig,
  bucket: string,
  path: string,
  uri: string,
): Promise<void> {
  const bytes = await (await fetch(uri)).arrayBuffer();
  const { error } = await cfg
    .requireClient()
    .storage.from(bucket)
    .upload(path, bytes, { contentType: "image/jpeg" });
  if (error) throw error;
}

export const GROUP_IMAGES_BUCKET = "group-images";

/** A live group picture's public URL. */
export function groupImageUrl(cfg: ResolvedCommunityConfig, path: string | null): string | null {
  if (!path) return null;
  return cfg.requireClient().storage.from(GROUP_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** A group status row value as the client model knows it. */
export function toGroupStatus(status: string | null): GroupStatus | null {
  return status === "visible" || status === "pending" || status === "hidden" ? status : null;
}

// ============ CONVERSATIONS ============

type ConversationRow = {
  conversation_id: string;
  kind: "dm" | "group";
  last_message_at: string | null;
  last_message_id: string | null;
  last_body: string | null;
  last_author_id: string | null;
  unread: number;
  notify: boolean;
  role: "member" | "creator";
  // groups/003; absent on a backend still on messaging/001's list_conversations.
  title?: string | null;
  image_path?: string | null;
  group_status?: string | null;
};

type DmPeerRow = { conversation_id: string; peer_id: string; my_state: "active" | "request" };

/** The member's active conversations, latest activity first. With dms, each DM gets
 * its peer and my state (`dm_peers`; none across a block). */
export async function fetchConversations(cfg: ResolvedCommunityConfig): Promise<Conversation[]> {
  requireMessaging(cfg);
  await requireUid(cfg);
  const [rows, peers] = await Promise.all([
    callRpc<ConversationRow[]>(cfg, "list_conversations"),
    cfg.modules.dms ? callRpc<DmPeerRow[]>(cfg, "dm_peers") : null,
  ]);
  const peerOf = new Map((peers ?? []).map((p) => [p.conversation_id, p]));
  return (rows ?? []).map((r) => ({
    id: r.conversation_id,
    kind: r.kind,
    lastMessageAt: r.last_message_at,
    lastMessage: r.last_message_id
      ? { id: r.last_message_id, body: r.last_body, authorId: r.last_author_id ?? "" }
      : null,
    unread: r.unread,
    notify: r.notify,
    role: r.role,
    title: r.title ?? null,
    imageUrl: groupImageUrl(cfg, r.image_path ?? null),
    groupStatus: toGroupStatus(r.group_status ?? null),
    peerId: peerOf.get(r.conversation_id)?.peer_id ?? null,
    requestState: peerOf.get(r.conversation_id)?.my_state ?? null,
  }));
}

/** Unread messages of the conversations the member follows (notify on). */
export async function unreadFollowedMessages(cfg: ResolvedCommunityConfig): Promise<number> {
  requireMessaging(cfg);
  await requireUid(cfg);
  return (await callRpc<number | null>(cfg, "unread_followed_messages")) ?? 0;
}

export async function markConversationRead(
  cfg: ResolvedCommunityConfig,
  conversationId: string,
): Promise<void> {
  requireMessaging(cfg);
  await requireUid(cfg);
  await callRpc(cfg, "mark_conversation_read", { p_conversation: conversationId });
}

/** False only when the accounts module is installed and the member has no linked account. */
export async function fetchAccountLinked(cfg: ResolvedCommunityConfig): Promise<boolean> {
  requireMessaging(cfg);
  await requireUid(cfg);
  return (await callRpc<boolean | null>(cfg, "my_account_linked")) === true;
}

// ============ MESSAGES ============

const MESSAGE_COLUMNS =
  "id, conversation_id, author_id, body, image_path, attachment_type, attachment_id, reply_to_id, status, deleted_by, edited_at, created_at, like_count";
// The reply target through its FK; RLS applies, so an unreadable target (hidden,
// a blocked author's) comes back null.
const MESSAGE_SELECT = `${MESSAGE_COLUMNS}, reply_to:reply_to_id(id, author_id, body, status)`;

type MessageRow = {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string | null;
  image_path: string | null;
  attachment_type: string | null;
  attachment_id: string | null;
  reply_to_id: string | null;
  status: "pending" | "visible" | "hidden" | "deleted";
  deleted_by: "author" | "creator" | "admin" | null;
  edited_at: string | null;
  created_at: string;
  like_count: number;
  reply_to?: { id: string; author_id: string; body: string | null; status: string } | null;
};

function mapMessageRow(r: MessageRow, likedByMe: boolean): ChatMessage {
  const reply = r.reply_to ?? null;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    authorId: r.author_id,
    body: r.body,
    imagePath: r.image_path,
    attachment:
      r.attachment_type && r.attachment_id
        ? { type: r.attachment_type, id: r.attachment_id }
        : null,
    replyTo: r.reply_to_id
      ? {
          id: r.reply_to_id,
          authorId: reply?.author_id ?? "",
          body: reply && reply.status === "visible" ? reply.body : null,
          deleted: !reply || reply.status === "deleted" || reply.status === "hidden",
        }
      : null,
    // Only the author reads a hidden (removed or rejected) message.
    status: r.status,
    deletedBy:
      r.status === "deleted" && (r.deleted_by === "author" || r.deleted_by === "creator")
        ? r.deleted_by
        : null,
    editedAt: r.edited_at,
    createdAt: r.created_at,
    likeCount: r.like_count,
    likedByMe,
  };
}

async function withMyLikes(
  cfg: ResolvedCommunityConfig,
  uid: string,
  rows: MessageRow[],
): Promise<ChatMessage[]> {
  if (rows.length === 0) return [];
  const { data, error } = await cfg
    .requireClient()
    .from("message_likes")
    .select("message_id")
    .eq("user_id", uid)
    .in(
      "message_id",
      rows.map((r) => r.id),
    );
  if (error) throw error;
  const liked = new Set((data ?? []).map((l) => (l as { message_id: string }).message_id));
  return rows.map((r) => mapMessageRow(r, liked.has(r.id)));
}

async function fetchMessage(cfg: ResolvedCommunityConfig, uid: string, id: string) {
  const { data, error } = await cfg
    .requireClient()
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("id", id)
    .single();
  if (error) throw error;
  const [message] = await withMyLikes(cfg, uid, [data as unknown as MessageRow]);
  return message!;
}

/** A page of a conversation, newest first (`created_at desc, id desc`). `before`:
 * the oldest loaded message (keyset cursor), so messages sharing a timestamp
 * across a page boundary are neither skipped nor repeated. */
export async function fetchMessages(
  cfg: ResolvedCommunityConfig,
  conversationId: string,
  opts: { before?: { createdAt: string; id: string }; limit?: number } = {},
): Promise<ChatMessage[]> {
  requireMessaging(cfg);
  const uid = await requireUid(cfg);
  let query = cfg
    .requireClient()
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId);
  if (opts.before) {
    // (created_at, id) < (before); quoted: timestamps hold PostgREST's reserved `.` and `:`.
    const at = `"${opts.before.createdAt}"`;
    query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${opts.before.id})`);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(opts.limit ?? MESSAGES_PAGE_SIZE);
  if (error) throw error;
  return withMyLikes(cfg, uid, (data ?? []) as unknown as MessageRow[]);
}

/** Decided from the row the RPC wrote (the backend's mode is the truth): pending
 * (`pre`, or any image) waits for the verdict; visible and not yet seen by the AI
 * (`post`) is checked in the background; `reportOnly` text is never sent. */
async function moderateWritten(
  cfg: ResolvedCommunityConfig,
  row: { id: string; status: string; moderated_at: string | null },
): Promise<void> {
  if (row.status === "pending") {
    await moderateOne(cfg, { kind: "message", id: row.id });
  } else if (row.status === "visible" && row.moderated_at === null) {
    void moderateOne(cfg, { kind: "message", id: row.id });
  }
}

export type SendMessageInput = {
  conversationId: string;
  body?: string;
  replyToId?: string;
  /** A local image URI (JPEG), uploaded before the message is sent. */
  imageUri?: string;
  attachment?: PostAttachment;
};

export async function sendMessage(
  cfg: ResolvedCommunityConfig,
  input: SendMessageInput,
): Promise<ChatMessage> {
  requireMessaging(cfg);
  const { conversationId, attachment } = input;
  if (attachment && !attachmentTypeAllowed(cfg, attachment.type))
    throw new MessagingError("invalid_attachment", "attachment type not enabled");
  const uid = await requireUid(cfg);
  let imagePath: string | null = null;
  if (input.imageUri) {
    imagePath = `${conversationId}/${uid}/${uuid()}.jpg`;
    await uploadJpeg(cfg, MESSAGE_IMAGES_BUCKET, imagePath, input.imageUri);
  }
  const row = await callRpc<{ id: string; status: string; moderated_at: string | null }>(
    cfg,
    "send_message",
    {
      p_conversation: conversationId,
      p_body: input.body ?? null,
      p_reply_to: input.replyToId ?? null,
      p_image_path: imagePath,
      p_attachment_type: attachment?.type ?? null,
      p_attachment_id: attachment?.id ?? null,
    },
  );
  await moderateWritten(cfg, row);
  // Read back: the reply target and, for an awaited verdict, the final status.
  return fetchMessage(cfg, uid, row.id);
}

/** Edits my message; moderated again like a new one. */
export async function editMessage(
  cfg: ResolvedCommunityConfig,
  id: string,
  body: string,
): Promise<ChatMessage> {
  requireMessaging(cfg);
  const uid = await requireUid(cfg);
  const row = await callRpc<{ id: string; status: string; moderated_at: string | null }>(
    cfg,
    "edit_message",
    { p_message: id, p_body: body },
  );
  await moderateWritten(cfg, row);
  return fetchMessage(cfg, uid, row.id);
}

/** The author's own, a group creator's on others (not an admin's), or an admin's. */
export async function deleteMessage(cfg: ResolvedCommunityConfig, id: string): Promise<void> {
  requireMessaging(cfg);
  await requireUid(cfg);
  await callRpc(cfg, "delete_message", { p_message: id });
}

export async function setMessageLike(
  cfg: ResolvedCommunityConfig,
  id: string,
  liked: boolean,
): Promise<void> {
  requireMessaging(cfg);
  await requireUid(cfg);
  await callRpc(cfg, "set_message_like", { p_message: id, p_liked: liked });
}

/** On-demand translation into `locale` (cached server-side). */
export async function translateMessage(
  cfg: ResolvedCommunityConfig,
  id: string,
  locale: string,
): Promise<string> {
  requireMessaging(cfg);
  await requireUid(cfg);
  const { data, error } = await cfg
    .requireClient()
    .functions.invoke("translate-message", { body: { messageId: id, locale } });
  if (error) throw error;
  return (data as { body: string }).body;
}

// Signed URLs live 60 min; reused for 50 so a cached one never expires on screen.
const SIGNED_URL_TTL_S = 3600;
const SIGNED_URL_REUSE_MS = 50 * 60_000;
/** A signed URL of a message image (private bucket), cached 50 minutes per member
 * (the cache is cleared on every identity change). */
export async function messageImageUrl(cfg: ResolvedCommunityConfig, path: string): Promise<string> {
  requireMessaging(cfg);
  const key = `${await requireUid(cfg)}:${path}`;
  const cached = cachedSignedUrl(key);
  if (cached) return cached;
  const { data, error } = await cfg
    .requireClient()
    .storage.from(MESSAGE_IMAGES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_S);
  if (error) throw error;
  cacheSignedUrl(key, data.signedUrl, SIGNED_URL_REUSE_MS);
  return data.signedUrl;
}
