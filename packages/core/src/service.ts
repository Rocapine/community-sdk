// Community backend service — every function is a thin wrapper around the injected
// Supabase client (`cfg.requireClient()`), so a host with `supabase: null` degrades to
// CommunityDisabledError instead of crashing when no backend is configured. No React
// imports here.
//
// Ported from the mold (`sdk/client/services/community.ts`) with a host app's newer
// feed/thread composition (search, poll batching via `poll_vote_counts`, reaction batching
// generalized from that host's prayer-style feature's summary RPC into `post_reaction_summary`).

import type { SupabaseClient } from "@supabase/supabase-js";
import { FunctionsHttpError } from "@supabase/supabase-js";

import type { ResolvedCommunityConfig } from "./config";
import { ensureIdentity } from "./identity";
import {
  EMPTY_POLL_DATA,
  EMPTY_REACTION_DATA,
  FEED_PAGE_SIZE,
  mapCommentRow,
  mapPostRow,
  mapProfileRow,
  type CommentRow,
  type CommunityProfile,
  type FeedPost,
  type PollData,
  type PostRow,
  type ProfileRow,
  type ReactionData,
  type ThreadComment,
} from "./models";

/** Avatar images live in this Storage bucket on every install (mold value, unchanged). */
const AVATAR_BUCKET = "avatars";

async function requireUid(cfg: ResolvedCommunityConfig): Promise<string> {
  const uid = await ensureIdentity(cfg);
  if (!uid) throw new Error("You appear to be offline. Please try again.");
  return uid;
}

// Embedded filter: comment counts only count visible comments, so the badge
// on a card always matches what the opened thread renders.
const FEED_SELECT =
  "id, author_id, topic, content, status, pinned_at, created_at, profiles!posts_author_id_fkey(username, is_official, handle, avatar_url), likes(count), comments(count), poll_options(id, idx, label)";

const PROFILE_SELECT = "id, username, handle, is_official, bio, avatar_url";

async function fetchMyLikes(
  client: SupabaseClient,
  postIds: string[],
  uid: string,
): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  const { data, error } = await client
    .from("likes")
    .select("post_id")
    .eq("user_id", uid)
    .in("post_id", postIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.post_id as string));
}

/**
 * Batched poll state for the poll posts of one page: per-option counts via the
 * security-definer RPC (poll_votes rows are private), my votes via RLS select.
 * Gated on `cfg.modules.polls`: off (or no poll posts on the page) skips the
 * RPC/select round trip entirely and returns the empty shape.
 */
async function fetchPollData(
  cfg: ResolvedCommunityConfig,
  postIds: string[],
  uid: string,
): Promise<PollData> {
  if (!cfg.modules.polls || postIds.length === 0) return EMPTY_POLL_DATA;
  const client = cfg.requireClient();
  const [countsRes, myVotesRes] = await Promise.all([
    client.rpc("poll_vote_counts", { p_post_ids: postIds }),
    client
      .from("poll_votes")
      .select("post_id, option_id")
      .eq("user_id", uid)
      .in("post_id", postIds),
  ]);
  if (countsRes.error) throw countsRes.error;
  if (myVotesRes.error) throw myVotesRes.error;
  const counts = new Map<string, number>();
  for (const row of (countsRes.data ?? []) as { option_id: string; votes: number }[]) {
    counts.set(row.option_id, Number(row.votes));
  }
  const myVotes = new Map<string, string>();
  for (const row of (myVotesRes.data ?? []) as { post_id: string; option_id: string }[]) {
    myVotes.set(row.post_id, row.option_id);
  }
  return { counts, myVotes };
}

/**
 * Batched reaction state for one page: count + last reactor's display name + my-reaction
 * flag, all from the single security-definer `post_reaction_summary` RPC (the backend
 * already resolves "did I react" server-side, so unlike the mold's prayer batching this
 * needs no second query). Gated on `cfg.modules.reaction`; a missing/erroring RPC (e.g.
 * the reaction module's migration not installed yet) degrades to no reaction data instead
 * of taking the whole feed down.
 */
export async function fetchReactionSummaries(
  cfg: ResolvedCommunityConfig,
  postIds: string[],
): Promise<ReactionData> {
  if (!cfg.modules.reaction || postIds.length === 0) return EMPTY_REACTION_DATA;
  const client = cfg.requireClient();
  const { data, error } = await client.rpc("post_reaction_summary", { p_post_ids: postIds });
  if (error) return EMPTY_REACTION_DATA;
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  const lastReactorName = new Map<string, string | null>();
  for (const row of (data ?? []) as {
    post_id: string;
    reaction_count: number;
    last_reactor_name: string | null;
    has_reacted: boolean;
  }[]) {
    counts.set(row.post_id, Number(row.reaction_count));
    lastReactorName.set(row.post_id, row.last_reactor_name);
    if (row.has_reacted) mine.add(row.post_id);
  }
  return { counts, mine, lastReactorName };
}

/** Attach my-like state + poll state + reaction state to a batch of raw post
 * rows and map to the UI model. */
async function toFeedPosts(
  cfg: ResolvedCommunityConfig,
  client: SupabaseClient,
  rows: PostRow[],
  uid: string,
): Promise<FeedPost[]> {
  const postIds = rows.map((r) => r.id);
  const [liked, pollData, reactionData] = await Promise.all([
    fetchMyLikes(client, postIds, uid),
    fetchPollData(
      cfg,
      rows.filter((r) => r.poll_options.length > 0).map((r) => r.id),
      uid,
    ),
    fetchReactionSummaries(cfg, postIds),
  ]);
  return rows.map((r) =>
    mapPostRow(r, uid, cfg.anonymousAuthorFallback, cfg.topics, liked, pollData, reactionData),
  );
}

/**
 * One feed page, newest first. RLS already excludes other users' hidden and
 * blocked-author content; we only exclude our own soft-deleted posts.
 */
export async function fetchFeedPage(
  cfg: ResolvedCommunityConfig,
  opts: { topic?: string; cursor?: number } = {},
): Promise<FeedPost[]> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const page = opts.cursor ?? 0;
  let query = client
    .from("posts")
    .select(FEED_SELECT)
    .eq("comments.status", "visible")
    // Others' rows are already limited to 'visible' by RLS; this also shows the
    // author their own 'pending' posts (optimistic) while hiding their moderated-out
    // ones.
    .in("status", ["visible", "pending"])
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(page * FEED_PAGE_SIZE, page * FEED_PAGE_SIZE + FEED_PAGE_SIZE - 1);
  if (opts.topic) query = query.eq("topic", opts.topic);
  const { data, error } = await query;
  if (error) throw error;
  return toFeedPosts(cfg, client, (data ?? []) as unknown as PostRow[], uid);
}

/**
 * Count of visible posts newer than `sinceIso`, excluding my own, for the
 * given topic. RLS already excludes blocked authors and hidden/deleted rows.
 * `topic` is beyond the brief's literal signature but kept (both source apps
 * take it) so a topic-filtered feed's "N new posts" pill stays accurate.
 */
export async function countNewPosts(
  cfg: ResolvedCommunityConfig,
  sinceIso: string,
  topic?: string,
): Promise<number> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  let query = client
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("status", "visible")
    .gt("created_at", sinceIso)
    .neq("author_id", uid);
  if (topic) query = query.eq("topic", topic);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** A single profile by id, e.g. for the profile page header. */
export async function fetchProfile(
  cfg: ResolvedCommunityConfig,
  userId: string,
): Promise<CommunityProfile> {
  const client = cfg.requireClient();
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", userId)
    .single();
  if (error) throw error;
  return mapProfileRow(data as unknown as ProfileRow, cfg.anonymousAuthorFallback);
}

/**
 * One user's posts, newest first (no pinned ordering — a profile page is
 * strictly chronological). Same visibility rules as the main feed. Per the
 * brief's signature this is a single page (FEED_PAGE_SIZE), unlike the mold's
 * paginated version — see the task report for the scope note.
 */
export async function fetchUserPosts(
  cfg: ResolvedCommunityConfig,
  userId: string,
): Promise<FeedPost[]> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { data, error } = await client
    .from("posts")
    .select(FEED_SELECT)
    .eq("author_id", userId)
    .eq("comments.status", "visible")
    .in("status", ["visible", "pending"])
    .order("created_at", { ascending: false })
    .range(0, FEED_PAGE_SIZE - 1);
  if (error) throw error;
  return toFeedPosts(cfg, client, (data ?? []) as unknown as PostRow[], uid);
}

/**
 * Full-text-ish search over visible post content (newest first). Single page
 * (FEED_PAGE_SIZE) per the brief's signature — see fetchUserPosts note.
 */
export async function searchPosts(
  cfg: ResolvedCommunityConfig,
  query: string,
): Promise<FeedPost[]> {
  const cleaned = query.trim();
  if (cleaned.length === 0) return [];
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { data, error } = await client
    .from("posts")
    .select(FEED_SELECT)
    .eq("comments.status", "visible")
    .eq("status", "visible")
    .ilike("content", `%${cleaned}%`)
    .order("created_at", { ascending: false })
    .range(0, FEED_PAGE_SIZE - 1);
  if (error) throw error;
  return toFeedPosts(cfg, client, (data ?? []) as unknown as PostRow[], uid);
}

export async function fetchThread(
  cfg: ResolvedCommunityConfig,
  postId: string,
): Promise<ThreadComment[]> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { data, error } = await client
    .from("comments")
    .select(
      "id, post_id, author_id, content, status, created_at, profiles(username, is_official, handle, avatar_url)",
    )
    .eq("post_id", postId)
    .in("status", ["visible", "pending"])
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as CommentRow[]).map((r) =>
    mapCommentRow(r, uid, cfg.anonymousAuthorFallback),
  );
}

/** Verdict returned by the synchronous moderate-one Edge Function. */
export type ModerationVerdict = { status: "published" | "rejected" | "pending"; reason?: string };

export type CreatePostInput = { topic: string; body: string; pollOptions?: string[] };

/**
 * Insert a post as 'pending' (invisible to others until moderated). Returns id.
 * With pollOptions, the post and its options are created transactionally by
 * the create_poll_post RPC (security invoker, same RLS as a plain insert);
 * that branch is gated on `cfg.modules.polls`.
 */
export async function createPost(
  cfg: ResolvedCommunityConfig,
  input: CreatePostInput,
): Promise<string> {
  const { topic, body, pollOptions } = input;
  const hasPoll = !!pollOptions && pollOptions.length > 0;
  if (hasPoll && !cfg.modules.polls) throw new Error("polls module is not enabled");
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  if (hasPoll) {
    const { data, error } = await client.rpc("create_poll_post", {
      p_topic: topic,
      p_content: body,
      p_options: pollOptions,
    });
    if (error) throw error;
    return data as string;
  }
  const { data, error } = await client
    .from("posts")
    .insert({ author_id: uid, topic, content: body })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/**
 * Cast or change my vote: one row per (post, user), upsert swaps the option.
 * `optionId` is the poll option's row id (matching `FeedPoll.myOptionId` /
 * `applyPollVote`'s optimistic-update contract from Task 3), not a numeric
 * index — see the task report for this naming call against the brief.
 * Gated on `cfg.modules.polls` for consistent DX with the reaction module.
 */
export async function votePoll(
  cfg: ResolvedCommunityConfig,
  postId: string,
  optionId: string,
): Promise<void> {
  if (!cfg.modules.polls) throw new Error("polls module is not enabled");
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { error } = await client
    .from("poll_votes")
    .upsert(
      { post_id: postId, option_id: optionId, user_id: uid },
      { onConflict: "post_id,user_id" },
    );
  if (error) throw error;
}

/** Insert a comment as 'pending'. Returns id. */
export async function createComment(
  cfg: ResolvedCommunityConfig,
  postId: string,
  body: string,
): Promise<string> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { data, error } = await client
    .from("comments")
    .insert({ post_id: postId, author_id: uid, content: body })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Run synchronous moderation on a just-created pending post/comment. */
export async function moderateOne(
  cfg: ResolvedCommunityConfig,
  input: { kind: "post" | "comment"; id: string },
): Promise<ModerationVerdict> {
  const client = cfg.requireClient();
  const { data, error } = await client.functions.invoke("moderate-one", { body: input });
  if (error) return { status: "pending", reason: "moderation unavailable" };
  return data as ModerationVerdict;
}

export async function setLike(
  cfg: ResolvedCommunityConfig,
  postId: string,
  on: boolean,
): Promise<void> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  if (on) {
    const { error } = await client.from("likes").insert({ post_id: postId, user_id: uid });
    // 23505 = already liked (double tap / retry): the desired state holds.
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await client.from("likes").delete().match({ post_id: postId, user_id: uid });
    if (error) throw error;
  }
}

/**
 * `setPrayed` generalized to `setReaction`: insert my private, non-retractable
 * reaction row (rows are never deleted — see spec §6). Gated on `cfg.modules.reaction`.
 */
export async function setReaction(cfg: ResolvedCommunityConfig, postId: string): Promise<void> {
  if (!cfg.modules.reaction) throw new Error("reaction module is not enabled");
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { error } = await client.from("post_reactions").insert({ post_id: postId, user_id: uid });
  // 23505 = already reacted to this post: the desired state holds.
  if (error && error.code !== "23505") throw error;
}

export type ReportReason = "spam" | "harassment" | "hate" | "inappropriate" | "other";

export interface ReportInput {
  reportedUserId: string;
  postId?: string;
  commentId?: string;
  reason: ReportReason;
  details?: string;
}

export async function reportContent(
  cfg: ResolvedCommunityConfig,
  input: ReportInput,
): Promise<void> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { error } = await client.from("reports").insert({
    reporter_id: uid,
    reported_user_id: input.reportedUserId,
    post_id: input.postId ?? null,
    comment_id: input.commentId ?? null,
    reason: input.reason,
    details: input.details?.trim() || null,
  });
  if (error) throw error;
}

export async function blockUser(cfg: ResolvedCommunityConfig, blockedId: string): Promise<void> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { error } = await client.from("blocks").insert({ blocker_id: uid, blocked_id: blockedId });
  if (error && error.code !== "23505") throw error; // already blocked is fine
}

export async function deleteOwnPost(cfg: ResolvedCommunityConfig, postId: string): Promise<void> {
  const client = cfg.requireClient();
  await requireUid(cfg);
  const { error } = await client.from("posts").update({ status: "deleted" }).eq("id", postId);
  if (error) throw error;
}

export async function deleteOwnComment(
  cfg: ResolvedCommunityConfig,
  commentId: string,
): Promise<void> {
  const client = cfg.requireClient();
  await requireUid(cfg);
  const { error } = await client.from("comments").update({ status: "deleted" }).eq("id", commentId);
  if (error) throw error;
}

/**
 * `avatarUrl` here is actually the Storage *path* returned by `uploadAvatar`
 * (mold field name `avatarPath`) — kept as `avatarUrl` per the brief's produced
 * signature and translated to the Edge Function's expected `avatarPath` body
 * key at the call site below.
 */
export type UpdateProfileInput = { handle?: string; bio?: string; avatarUrl?: string };

export type UpdateProfileResult =
  | { status: "ok"; handle: string | null; bio: string | null; avatarUrl: string | null }
  | { status: "rejected"; field: "handle" | "bio" | "avatar"; reason?: string }
  | { status: "error"; code?: "handle_taken"; error?: string };

/**
 * The only write path for handle/bio/avatar — moderated server-side by the
 * `update-profile` Edge Function. `invoke` treats any non-2xx as `error`; a
 * `FunctionsHttpError` carries the typed JSON body (e.g. `handle_taken`) on
 * its `context` response, other error kinds mean the request never landed.
 */
export async function updateProfile(
  cfg: ResolvedCommunityConfig,
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  const client = cfg.requireClient();
  const { handle, bio, avatarUrl } = input;
  const { data, error } = await client.functions.invoke("update-profile", {
    body: { handle, bio, avatarPath: avatarUrl },
  });
  if (!error) return data as UpdateProfileResult;
  if (error instanceof FunctionsHttpError) {
    // A platform-level 5xx can carry a non-JSON body: degrade to a network error.
    try {
      return (await error.context.json()) as UpdateProfileResult;
    } catch {
      return { status: "error", error: "network" };
    }
  }
  return { status: "error", error: "network" };
}

/**
 * Upload a JPEG avatar to the `avatars` bucket from a local file URI. Returns
 * the storage path. Takes a `fileUri` (not a base64 string, unlike the mold)
 * so the core has no Hermes/`atob` dependency — `fetch` on a `file://` URI is
 * the portable way to read local bytes in React Native.
 */
export async function uploadAvatar(cfg: ResolvedCommunityConfig, fileUri: string): Promise<string> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const path = `${uid}/${Date.now()}.jpg`;
  const response = await fetch(fileUri);
  const bytes = await response.arrayBuffer();
  const { error } = await client.storage
    .from(AVATAR_BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}
