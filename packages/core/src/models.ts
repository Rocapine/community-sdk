// Pure mapping between community backend rows and UI models.
// No React Native / Supabase imports: this module is exercised by vitest in a node env.

import type { CommunityTopicDef } from "./config";

export const FEED_PAGE_SIZE = 20;

// ============ DB-MIRRORING LIMITS (DO NOT CHANGE WITHOUT CHECKING THE DB) ============
// Client-side mirrors of the community backend's check constraints, so the cap is an
// invisible input limit instead of a generic insert error. Verified against the mold's
// own constants on 2026-08-31 — POST_MAX_LENGTH and COMMENT_MAX_LENGTH differ from the
// task brief's placeholder values (600 / 300); the mold/DB values below win.

export const POST_MAX_LENGTH = 2000;
export const COMMENT_MAX_LENGTH = 1000;

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;
export const POLL_OPTION_MAX_LENGTH = 60;

/** Raw shape returned by the feed select (see the services layer). */
export interface PostRow {
  id: string;
  author_id: string;
  topic: string | null;
  content: string;
  status: "visible" | "hidden" | "deleted";
  pinned_at: string | null;
  created_at: string;
  profiles: {
    username: string | null;
    is_official: boolean | null;
    handle: string | null;
    avatar_url: string | null;
  } | null;
  likes: { count: number }[];
  comments: { count: number }[];
  /** Empty for a post without a poll. */
  poll_options: PollOptionRow[];
}

export interface PollOptionRow {
  id: string;
  idx: number;
  label: string;
}

export interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  status: "visible" | "hidden" | "deleted";
  created_at: string;
  profiles: {
    username: string | null;
    is_official: boolean | null;
    handle: string | null;
    avatar_url: string | null;
  } | null;
}

export interface PollOption {
  id: string;
  label: string;
  votes: number;
}

export interface FeedPoll {
  /** In creation order (idx). */
  options: PollOption[];
  /** Option id I voted for; null until I vote. */
  myOptionId: string | null;
  totalVotes: number;
}

/** Batched per-post poll state fetched alongside a feed page:
 * counts is option_id -> votes, myVotes is post_id -> my option_id. */
export interface PollData {
  counts: ReadonlyMap<string, number>;
  myVotes: ReadonlyMap<string, string>;
}

export const EMPTY_POLL_DATA: PollData = { counts: new Map(), myVotes: new Map() };

/** Batched per-post reaction state fetched alongside a feed page (generalized from
 * a host app's prayer-style feature: prayerCount/hasPrayed -> reactionCount/hasReacted).
 * `lastReactorName` mirrors the backend's security-definer summary RPC, which returns
 * each post's most recent reactor's display name alongside the count. */
export interface ReactionData {
  counts: ReadonlyMap<string, number>;
  mine: ReadonlySet<string>;
  lastReactorName: ReadonlyMap<string, string | null>;
}

export const EMPTY_REACTION_DATA: ReactionData = {
  counts: new Map(),
  mine: new Set(),
  lastReactorName: new Map(),
};

export interface FeedPost {
  id: string;
  authorId: string;
  authorName: string;
  /** Official house account — renders a verified seal. */
  authorOfficial: boolean;
  /** Unique public handle, e.g. "marie-4821". Null on stale caches. */
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  /** App-defined free text; unknown values stay visible under their raw id (see normalizeTopic). */
  topic: string | null;
  text: string;
  /** 'deleted' rows are excluded at the query level, so never present here. */
  status: "visible" | "hidden";
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  isOwn: boolean;
  createdAt: string;
  /** Set when the dashboard pinned this post; pinned posts sort first. */
  pinnedAt: string | null;
  /** Present when the post carries a poll. */
  poll: FeedPoll | null;
  /** Generic "reaction" module count (e.g. a "pray for" tap); the label/verb is host-defined. */
  reactionCount: number;
  hasReacted: boolean;
  /** Display name of the most recent reactor, for a "X and N others reacted" affordance;
   * null when nobody has reacted yet or the reaction module is off. */
  lastReactorName: string | null;
}

export interface ThreadComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorOfficial: boolean;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  text: string;
  isOwn: boolean;
  createdAt: string;
}

/**
 * Public display name, with a host-configured fallback for profiles not yet named.
 * Accepts either a raw username or any profile-shaped object carrying one (a row's
 * `.profiles`, a `ProfileRow`, or a previously-mapped `CommunityProfile`).
 */
export function displayName(
  profile: string | null | undefined | { username?: string | null },
  fallback: string,
): string {
  const raw = typeof profile === "string" || profile == null ? profile : profile.username;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * The topic column is app-defined free text. Unlike the mold (which dropped topics
 * unknown to the app's static list), unknown topics stay visible under their raw id —
 * the topics list is now host-config-driven and may lag behind live data.
 */
export function normalizeTopic(
  raw: string | null,
  topics: readonly CommunityTopicDef[],
): string | null {
  if (!raw) return null;
  const known = topics.find((t) => t.id === raw);
  return known ? known.id : raw;
}

export interface ProfileRow {
  id: string;
  username: string | null;
  handle: string | null;
  is_official: boolean | null;
  bio: string | null;
  avatar_url: string | null;
}

export interface CommunityProfile {
  id: string;
  name: string;
  handle: string | null;
  official: boolean;
  bio: string | null;
  avatarUrl: string | null;
  /** Raw username, when available (pre-fallback, unlike `name`); populated by
   * mapProfileRow so a CommunityProfile can itself be threaded back into displayName(). */
  username?: string | null;
}

export function mapProfileRow(row: ProfileRow, fallback: string): CommunityProfile {
  return {
    id: row.id,
    name: displayName(row, fallback),
    handle: row.handle ?? null,
    official: row.is_official ?? false,
    bio: row.bio ?? null,
    avatarUrl: row.avatar_url ?? null,
    // Raw username (pre-fallback), so a mapped CommunityProfile can itself be threaded back
    // into displayName() elsewhere — see the field doc on CommunityProfile.
    username: row.username ?? null,
  };
}

/** Assemble a FeedPoll from the embedded option rows + batched vote data. */
export function buildPoll(
  options: PollOptionRow[],
  counts: ReadonlyMap<string, number>,
  myOptionId: string | null,
): FeedPoll | null {
  if (options.length === 0) return null;
  const mapped = [...options]
    .sort((a, b) => a.idx - b.idx)
    .map((o) => ({ id: o.id, label: o.label, votes: counts.get(o.id) ?? 0 }));
  return {
    options: mapped,
    myOptionId,
    totalVotes: mapped.reduce((sum, o) => sum + o.votes, 0),
  };
}

/** Integer percentage for a result bar; a zero-vote poll shows 0% everywhere. */
export function pollPercent(votes: number, totalVotes: number): number {
  if (totalVotes <= 0) return 0;
  return Math.round((votes / totalVotes) * 100);
}

export function mapPostRow(
  row: PostRow,
  myUid: string,
  fallback: string,
  topics: readonly CommunityTopicDef[],
  likedPostIds: ReadonlySet<string>,
  pollData: PollData = EMPTY_POLL_DATA,
  reactionData: ReactionData = EMPTY_REACTION_DATA,
  /** Host extension point (`CommunityConfig.feed.transformPost`), run last with
   * the raw row (including any `extraPostColumns`) this post was built from. */
  transformPost?: (post: FeedPost, row: Record<string, unknown>) => FeedPost,
): FeedPost {
  const post: FeedPost = {
    id: row.id,
    authorId: row.author_id,
    authorName: displayName(row.profiles, fallback),
    authorOfficial: row.profiles?.is_official ?? false,
    authorHandle: row.profiles?.handle ?? null,
    authorAvatarUrl: row.profiles?.avatar_url ?? null,
    topic: normalizeTopic(row.topic, topics),
    text: row.content,
    status: row.status === "hidden" ? "hidden" : "visible",
    likeCount: row.likes[0]?.count ?? 0,
    commentCount: row.comments[0]?.count ?? 0,
    likedByMe: likedPostIds.has(row.id),
    isOwn: row.author_id === myUid,
    createdAt: row.created_at,
    pinnedAt: row.pinned_at,
    poll: buildPoll(row.poll_options, pollData.counts, pollData.myVotes.get(row.id) ?? null),
    reactionCount: reactionData.counts.get(row.id) ?? 0,
    hasReacted: reactionData.mine.has(row.id),
    lastReactorName: reactionData.lastReactorName.get(row.id) ?? null,
  };
  return transformPost ? transformPost(post, row as unknown as Record<string, unknown>) : post;
}

/**
 * Optimistic vote application: moves my vote to `optionId` on the matching
 * post, shifting per-option counts; the total only grows on a first vote.
 */
export function applyPollVote(post: FeedPost, postId: string, optionId: string): FeedPost {
  if (post.id !== postId || !post.poll) return post;
  const prev = post.poll.myOptionId;
  if (prev === optionId) return post;
  return {
    ...post,
    poll: {
      options: post.poll.options.map((o) => ({
        ...o,
        votes: o.votes + (o.id === optionId ? 1 : 0) - (o.id === prev ? 1 : 0),
      })),
      myOptionId: optionId,
      totalVotes: post.poll.totalVotes + (prev === null ? 1 : 0),
    },
  };
}

/**
 * Optimistic reaction application: +1 and hasReacted on the given post
 * (idempotent: re-applying to an already-reacted post is a no-op that returns
 * the same object back). Generalized from a host app's applyPrayer — the
 * caller is expected to have already located the target post (e.g. via
 * `posts.map((p) => (p.id === postId ? applyReaction(p) : p))`).
 */
export function applyReaction(post: FeedPost): FeedPost {
  if (post.hasReacted) return post;
  return { ...post, hasReacted: true, reactionCount: post.reactionCount + 1 };
}

export function mapCommentRow(row: CommentRow, myUid: string, fallback: string): ThreadComment {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    authorName: displayName(row.profiles, fallback),
    authorOfficial: row.profiles?.is_official ?? false,
    authorHandle: row.profiles?.handle ?? null,
    authorAvatarUrl: row.profiles?.avatar_url ?? null,
    text: row.content,
    isOwn: row.author_id === myUid,
    createdAt: row.created_at,
  };
}

/** Floating pill label. "1 new post" / "N new posts". */
export function newPostsLabel(count: number): string {
  return count === 1 ? "1 new post" : `${count} new posts`;
}

/**
 * Max createdAt across loaded posts. posts[0] is no longer the newest once a
 * pinned post floats to the top, and the new-posts pill must not count the
 * already-visible pinned post as "new".
 */
export function newestCreatedAt(posts: readonly { createdAt: string }[]): string | null {
  let newest: string | null = null;
  for (const p of posts) {
    if (newest === null || Date.parse(p.createdAt) > Date.parse(newest)) newest = p.createdAt;
  }
  return newest;
}
