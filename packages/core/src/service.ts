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
import { readerLocale } from "./locale";
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
  type LocalImage,
  type PollData,
  type PostRow,
  type ProfileRow,
  type ReactionData,
  type ThreadComment,
} from "./models";

/** Avatar images live in this Storage bucket on every install (mold value, unchanged). */
const AVATAR_BUCKET = "avatars";
export const POST_IMAGES_BUCKET = "post-images";

/** Selected only when the images module is on: installs without the module
 * don't have these columns and PostgREST would reject the whole select. */
const IMAGE_COLUMNS = "image_path, image_width, image_height";

async function requireUid(cfg: ResolvedCommunityConfig): Promise<string> {
  const uid = await ensureIdentity(cfg);
  if (!uid) throw new Error("You appear to be offline. Please try again.");
  return uid;
}

// Embedded filter: comment counts only count visible comments, so the badge
// on a card always matches what the opened thread renders.
const FEED_SELECT =
  "id, author_id, topic, content, status, pinned_at, created_at, profiles!posts_author_id_fkey(username, is_official, handle, avatar_url), likes(count), comments(count)";

/** Embedded only when the polls module is on: on a core-only backend the
 * `poll_options` table does not exist and PostgREST rejects the whole select
 * (PGRST200), which took the entire feed down for such installs. */
const POLL_OPTIONS_SELECT = "poll_options(id, idx, label)";

/** Same embed, plus each option's translation row — used when the reader has
 * a resolved translation locale (see `readerLocale`). */
const POLL_OPTIONS_TRANSLATED_SELECT =
  "poll_options(id, idx, label, poll_option_translations(content))";

/** Embedded only when the reader has a resolved translation locale. */
const POST_TRANSLATIONS_SELECT = "post_translations(locale, source_locale, content)";

const COMMENTS_SELECT =
  "id, post_id, author_id, parent_id, content, status, created_at, profiles(username, is_official, handle, avatar_url), comment_likes(count)";

/** Embedded only when the reader has a resolved translation locale. */
const COMMENT_TRANSLATIONS_SELECT = "comment_translations(locale, source_locale, content)";

const PROFILE_SELECT = "id, username, handle, is_official, bio, avatar_url";

/** Minimal injection guard for `CommunityConfig.feed.extraPostColumns`: a bare
 * column name only, no `.`, `(`, `:`, whitespace, etc. — those are how a
 * PostgREST select embeds a relation or renames a column, and letting them
 * through would extend the query in ways this extension point isn't meant to
 * allow. */
const VALID_EXTRA_COLUMN = /^[a-z0-9_]+$/;

/**
 * Appends `extraPostColumns` (if any) to the posts feed select. Pure and
 * exported so it's unit-testable without a Supabase client. Invalid column
 * names are dropped with a `console.warn` rather than failing the query.
 */
export function buildFeedSelect(
  extraPostColumns?: readonly string[],
  polls = false,
  translations = false,
  images = false,
): string {
  const parts = [FEED_SELECT];
  if (polls) parts.push(translations ? POLL_OPTIONS_TRANSLATED_SELECT : POLL_OPTIONS_SELECT);
  if (translations) parts.push(POST_TRANSLATIONS_SELECT);
  if (images) parts.push(IMAGE_COLUMNS);
  const base = parts.join(", ");
  if (!extraPostColumns || extraPostColumns.length === 0) return base;
  const valid = extraPostColumns.filter((column) => {
    if (VALID_EXTRA_COLUMN.test(column)) return true;
    console.warn(
      `[@rocapine/community-core] ignoring invalid feed.extraPostColumns entry: ${JSON.stringify(column)}`,
    );
    return false;
  });
  if (valid.length === 0) return base;
  return `${base}, ${valid.join(", ")}`;
}

/** The posts select for this install: `feed.extraPostColumns` + the poll
 * embed iff `modules.polls`, + translation embeds iff the reader has a
 * resolved translation locale. */
function postsSelect(cfg: ResolvedCommunityConfig): string {
  return buildFeedSelect(
    cfg.feed.extraPostColumns,
    cfg.modules.polls,
    readerLocale(cfg) !== null,
    !!cfg.modules.images,
  );
}

/** Public URL prefix of the `post-images` bucket (ends with `/`); undefined
 * when the images module is off. */
function imageBase(cfg: ResolvedCommunityConfig): string | undefined {
  if (!cfg.modules.images) return undefined;
  const { publicUrl } = cfg.requireClient().storage.from(POST_IMAGES_BUCKET).getPublicUrl("").data;
  return publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`;
}

/** Embedded-resource filters: keep only the reader locale's translation rows,
 * so `rows?.[0]` in the mappers is always that locale, never some other
 * locale's leftover row. PostgREST accepts dotted paths for nested embeds,
 * the same mechanism as the existing `.eq("comments.status", "visible")`. A
 * no-op (module off / no resolved locale) leaves the query, and therefore
 * every byte of it, unchanged from before translations existed. */
export function withTranslationFilters<Q extends { eq(column: string, value: string): Q }>(
  query: Q,
  cfg: ResolvedCommunityConfig,
): Q {
  const locale = readerLocale(cfg);
  if (!locale) return query;
  let q = query.eq("post_translations.locale", locale);
  if (cfg.modules.polls) q = q.eq("poll_options.poll_option_translations.locale", locale);
  return q;
}

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
      rows.filter((r) => (r.poll_options ?? []).length > 0).map((r) => r.id),
      uid,
    ),
    fetchReactionSummaries(cfg, postIds),
  ]);
  const base = imageBase(cfg);
  return rows.map((r) =>
    mapPostRow(
      r,
      uid,
      cfg.authorFallback(),
      cfg.topics,
      liked,
      pollData,
      reactionData,
      cfg.feed.transformPost,
      base,
    ),
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
    .select(postsSelect(cfg))
    .eq("comments.status", "visible")
    // Others' rows are already limited to 'visible' by RLS; this also shows the
    // author their own 'pending' posts (optimistic) while hiding their moderated-out
    // ones.
    .in("status", ["visible", "pending"])
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(page * FEED_PAGE_SIZE, page * FEED_PAGE_SIZE + FEED_PAGE_SIZE - 1);
  query = withTranslationFilters(query, cfg);
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
  return mapProfileRow(data as unknown as ProfileRow, cfg.authorFallback());
}

/**
 * One user's posts, newest first (no pinned ordering — a profile page is
 * strictly chronological). Same visibility rules as the main feed, same
 * page-index cursor as `fetchFeedPage` (product decision, reversing the
 * earlier single-page scope cut).
 */
export async function fetchUserPosts(
  cfg: ResolvedCommunityConfig,
  userId: string,
  opts: { cursor?: number } = {},
): Promise<FeedPost[]> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const page = opts.cursor ?? 0;
  let query = client
    .from("posts")
    .select(postsSelect(cfg))
    .eq("author_id", userId)
    .eq("comments.status", "visible")
    .in("status", ["visible", "pending"])
    .order("created_at", { ascending: false })
    .range(page * FEED_PAGE_SIZE, page * FEED_PAGE_SIZE + FEED_PAGE_SIZE - 1);
  query = withTranslationFilters(query, cfg);
  const { data, error } = await query;
  if (error) throw error;
  return toFeedPosts(cfg, client, (data ?? []) as unknown as PostRow[], uid);
}

/**
 * Full-text-ish search over visible post content (newest first), same
 * page-index cursor as `fetchFeedPage` (product decision, reversing the
 * earlier single-page scope cut).
 */
export async function searchPosts(
  cfg: ResolvedCommunityConfig,
  searchTerm: string,
  opts: { cursor?: number } = {},
): Promise<FeedPost[]> {
  const cleaned = searchTerm.trim();
  if (cleaned.length === 0) return [];
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const page = opts.cursor ?? 0;
  let query = client
    .from("posts")
    .select(postsSelect(cfg))
    .eq("comments.status", "visible")
    .eq("status", "visible")
    .ilike("content", `%${cleaned}%`)
    .order("created_at", { ascending: false })
    .range(page * FEED_PAGE_SIZE, page * FEED_PAGE_SIZE + FEED_PAGE_SIZE - 1);
  query = withTranslationFilters(query, cfg);
  const { data, error } = await query;
  if (error) throw error;
  return toFeedPosts(cfg, client, (data ?? []) as unknown as PostRow[], uid);
}

/** The thread (comments) select: + the translation embed iff the reader has a
 * resolved translation locale. */
export function threadSelect(cfg: ResolvedCommunityConfig): string {
  const parts = [COMMENTS_SELECT];
  if (readerLocale(cfg)) parts.push(COMMENT_TRANSLATIONS_SELECT);
  if (cfg.modules.images) parts.push(IMAGE_COLUMNS);
  return parts.join(", ");
}

/**
 * Note: `cfg.feed.extraPostColumns`/`transformPost` do NOT apply here — this
 * queries `comments`, not `posts` (the thread's parent post is passed in by
 * the caller from an already-fetched, already-transformed `FeedPost`, not
 * re-fetched).
 */
export async function fetchThread(
  cfg: ResolvedCommunityConfig,
  postId: string,
): Promise<ThreadComment[]> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const locale = readerLocale(cfg);
  let query = client
    .from("comments")
    .select(threadSelect(cfg))
    .eq("post_id", postId)
    .in("status", ["visible", "pending"])
    .order("created_at", { ascending: true });
  if (locale) query = query.eq("comment_translations.locale", locale);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as CommentRow[];
  // Which of these the reader liked: a second, id-scoped query (an embed
  // filtered on user_id would hide the other likes from the count).
  const liked = new Set<string>();
  if (rows.length > 0) {
    const { data: mine, error: likesError } = await client
      .from("comment_likes")
      .select("comment_id")
      .eq("user_id", uid)
      .in(
        "comment_id",
        rows.map((r) => r.id),
      );
    if (likesError) throw likesError;
    for (const l of mine ?? []) liked.add((l as { comment_id: string }).comment_id);
  }
  const base = imageBase(cfg);
  return rows.map((r) => mapCommentRow(r, uid, cfg.authorFallback(), base, liked.has(r.id)));
}

/** Verdict returned by the synchronous moderate-one Edge Function. */
export type ModerationVerdict = { status: "published" | "rejected" | "pending"; reason?: string };

/** What `uploadPostImage` returns and `createPost`/`createComment` store. */
export type UploadedImage = { path: string; width: number; height: number };

export type CreatePostInput = {
  topic: string;
  body: string;
  pollOptions?: string[];
  image?: UploadedImage;
};

const imageColumns = (image?: UploadedImage) =>
  image ? { image_path: image.path, image_width: image.width, image_height: image.height } : {};

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
  const { topic, body, pollOptions, image } = input;
  const hasPoll = !!pollOptions && pollOptions.length > 0;
  if (hasPoll && !cfg.modules.polls) throw new Error("polls module is not enabled");
  if (image && !cfg.modules.images) throw new Error("images module is not enabled");
  if (image && hasPoll) throw new Error("a post cannot have both a poll and an image");
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
    .insert({ author_id: uid, topic, content: body, ...imageColumns(image) })
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
  image?: UploadedImage,
  parentId?: string,
): Promise<string> {
  if (image && !cfg.modules.images) throw new Error("images module is not enabled");
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { data, error } = await client
    .from("comments")
    .insert({
      post_id: postId,
      author_id: uid,
      content: body,
      ...imageColumns(image),
      // Only a reply sends it: a top-level comment stays insertable on a
      // backend without core/010_comment_threads.sql.
      ...(parentId ? { parent_id: parentId } : {}),
    })
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

/** Like or unlike a comment as the reader. */
export async function setCommentLike(
  cfg: ResolvedCommunityConfig,
  commentId: string,
  on: boolean,
): Promise<void> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  if (on) {
    const { error } = await client
      .from("comment_likes")
      .insert({ comment_id: commentId, user_id: uid });
    // 23505 = already liked (double tap / retry): the desired state holds.
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await client
      .from("comment_likes")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", uid);
    if (error) throw error;
  }
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
 * `setPrayed` generalized to `setReaction`: insert (`on`) or delete my private
 * reaction row, like `setLike`. Gated on `cfg.modules.reaction`.
 */
export async function setReaction(
  cfg: ResolvedCommunityConfig,
  postId: string,
  on = true,
): Promise<void> {
  if (!cfg.modules.reaction) throw new Error("reaction module is not enabled");
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  if (on) {
    const { error } = await client.from("post_reactions").insert({ post_id: postId, user_id: uid });
    // 23505 = already reacted to this post: the desired state holds.
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await client
      .from("post_reactions")
      .delete()
      .match({ post_id: postId, user_id: uid });
    if (error) throw error;
  }
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

export const NOTIFICATION_PREFERENCE_KEYS = [
  "notify_likes",
  "notify_comments",
  "notify_reactions",
] as const;
export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];
export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

/** The caller's `push_tokens` preferences (push module); `null` while the device has no push row. */
export async function fetchNotificationPreferences(
  cfg: ResolvedCommunityConfig,
): Promise<NotificationPreferences | null> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { data, error } = await client
    .from("push_tokens")
    .select(NOTIFICATION_PREFERENCE_KEYS.join(","))
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as NotificationPreferences | null) ?? null;
}

export async function setNotificationPreference(
  cfg: ResolvedCommunityConfig,
  key: NotificationPreferenceKey,
  enabled: boolean,
): Promise<void> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const { error } = await client
    .from("push_tokens")
    .update({ [key]: enabled })
    .eq("user_id", uid);
  if (error) throw error;
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
/** `username` is the display name shown on posts; `handle` the @handle. All fields are moderated server-side. */
export type UpdateProfileInput = {
  username?: string;
  handle?: string;
  bio?: string;
  avatarUrl?: string;
};

export type UpdateProfileResult =
  | {
      status: "ok";
      username: string | null;
      handle: string | null;
      bio: string | null;
      avatarUrl: string | null;
    }
  | { status: "rejected"; field: "username" | "handle" | "bio" | "avatar"; reason?: string }
  | {
      status: "error";
      /** `handle_taken` carries a free `suggestion` ("superuser-4821") when one was found. */
      code?: "handle_taken";
      suggestion?: string | null;
      error?: string;
    };

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
  const { username, handle, bio, avatarUrl } = input;
  const { data, error } = await client.functions.invoke("update-profile", {
    body: { username, handle, bio, avatarPath: avatarUrl },
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

/**
 * Upload a re-encoded JPEG (see `LocalImage`) to the public `post-images`
 * bucket under the caller's own folder. Returns what `createPost` /
 * `createComment` store; the public URL is rebuilt from `path` on read.
 */
export async function uploadPostImage(
  cfg: ResolvedCommunityConfig,
  image: LocalImage,
): Promise<UploadedImage> {
  const client = cfg.requireClient();
  const uid = await requireUid(cfg);
  const id =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${uid}/${id}.jpg`;
  const response = await fetch(image.url);
  const bytes = await response.arrayBuffer();
  const { error } = await client.storage
    .from(POST_IMAGES_BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg" });
  if (error) throw error;
  return { path, width: image.width, height: image.height };
}
