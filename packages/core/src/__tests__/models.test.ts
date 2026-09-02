import { expect, it } from "vitest";
import {
  applyPollVote,
  applyReaction,
  buildPoll,
  displayName,
  mapCommentRow,
  mapPostRow,
  mapProfileRow,
  newestCreatedAt,
  newPostsLabel,
  normalizeTopic,
  pollPercent,
  type CommentRow,
  type CommunityProfile,
  type FeedPost,
  type PostRow,
} from "../models";
import type { CommunityTopicDef } from "../config";

// Test-local fallback string — the pure core no longer hardcodes a brand voice
// (that lived in the mold's app-specific ANON_NAME_FALLBACK constant); a host
// config now supplies it as `anonymousAuthorFallback`.
const ANON_NAME_FALLBACK = "A member";

const TOPICS: CommunityTopicDef[] = [
  { id: "news", officialOnly: true },
  { id: "general" },
  { id: "question" },
  { id: "encouragement" },
  { id: "tips" },
];

const postRow = (over: Partial<PostRow> = {}): PostRow => ({
  id: "p1",
  author_id: "u1",
  topic: "question",
  content: "hello",
  status: "visible",
  pinned_at: null,
  created_at: "2026-07-08T10:00:00Z",
  profiles: { username: "Hannah", is_official: false, handle: "hannah-1234", avatar_url: null },
  likes: [{ count: 3 }],
  comments: [{ count: 2 }],
  poll_options: [],
  ...over,
});

const makePost = (over: Partial<FeedPost> = {}): FeedPost => ({
  id: "p1",
  authorId: "u1",
  authorName: "Hannah",
  authorOfficial: false,
  authorHandle: "hannah-1234",
  authorAvatarUrl: null,
  topic: "question",
  text: "hello",
  status: "visible",
  likeCount: 0,
  commentCount: 0,
  likedByMe: false,
  isOwn: false,
  createdAt: "2026-07-08T10:00:00Z",
  pinnedAt: null,
  poll: null,
  reactionCount: 0,
  hasReacted: false,
  lastReactorName: null,
  ...over,
});

it("displayName falls back for missing usernames", () => {
  expect(displayName("Hannah", ANON_NAME_FALLBACK)).toBe("Hannah");
  expect(displayName("  ", ANON_NAME_FALLBACK)).toBe(ANON_NAME_FALLBACK);
  expect(displayName(null, ANON_NAME_FALLBACK)).toBe(ANON_NAME_FALLBACK);
  expect(displayName(undefined, ANON_NAME_FALLBACK)).toBe(ANON_NAME_FALLBACK);
});

it("displayName falls back to the configured anonymous name", () => {
  expect(displayName({ username: null, handle: "x" } as CommunityProfile, "Wanderer")).toBe(
    "Wanderer",
  );
});

it("normalizeTopic accepts known topics and keeps unknown ones visible under their raw id", () => {
  expect(normalizeTopic("question", TOPICS)).toBe("question");
  expect(normalizeTopic("encouragement", TOPICS)).toBe("encouragement");
  expect(normalizeTopic("news", TOPICS)).toBe("news");
  expect(normalizeTopic("random", TOPICS)).toBe("random");
  expect(normalizeTopic(null, TOPICS)).toBeNull();
});

it("mapPostRow extracts counts, like state and ownership", () => {
  const post = mapPostRow(postRow(), "u1", ANON_NAME_FALLBACK, TOPICS, new Set(["p1"]));
  expect(post).toEqual({
    id: "p1",
    authorId: "u1",
    authorName: "Hannah",
    authorOfficial: false,
    authorHandle: "hannah-1234",
    authorAvatarUrl: null,
    topic: "question",
    text: "hello",
    status: "visible",
    likeCount: 3,
    commentCount: 2,
    likedByMe: true,
    isOwn: true,
    createdAt: "2026-07-08T10:00:00Z",
    pinnedAt: null,
    poll: null,
    reactionCount: 0,
    hasReacted: false,
    lastReactorName: null,
  });
});

it("mapPostRow handles missing aggregates and foreign profile", () => {
  const post = mapPostRow(
    postRow({ profiles: null, likes: [], comments: [], topic: "junk" }),
    "u2",
    ANON_NAME_FALLBACK,
    TOPICS,
    new Set(),
  );
  expect(post.authorName).toBe(ANON_NAME_FALLBACK);
  expect(post.likeCount).toBe(0);
  expect(post.commentCount).toBe(0);
  expect(post.likedByMe).toBe(false);
  expect(post.isOwn).toBe(false);
  // Unlike the mold (which dropped unknown topics to null), "junk" stays visible under its raw id.
  expect(post.topic).toBe("junk");
});

it("mapPostRow keeps own hidden posts as hidden status", () => {
  const post = mapPostRow(
    postRow({ status: "hidden" }),
    "u1",
    ANON_NAME_FALLBACK,
    TOPICS,
    new Set(),
  );
  expect(post.status).toBe("hidden");
});

it("mapPostRow carries pinnedAt and tolerates a missing handle", () => {
  const pinned = mapPostRow(
    postRow({
      pinned_at: "2026-07-19T08:00:00Z",
      profiles: { username: "House Account", is_official: true, handle: null, avatar_url: null },
    }),
    "u2",
    ANON_NAME_FALLBACK,
    TOPICS,
    new Set(),
  );
  expect(pinned.pinnedAt).toBe("2026-07-19T08:00:00Z");
  expect(pinned.authorHandle).toBeNull();
});

it("mapPostRow reads reaction count, hasReacted and lastReactorName from batched reaction data", () => {
  const reacted = mapPostRow(postRow(), "u1", ANON_NAME_FALLBACK, TOPICS, new Set(), undefined, {
    counts: new Map([["p1", 4]]),
    mine: new Set(["p1"]),
    lastReactorName: new Map([["p1", "Hannah"]]),
  });
  expect(reacted.reactionCount).toBe(4);
  expect(reacted.hasReacted).toBe(true);
  expect(reacted.lastReactorName).toBe("Hannah");

  const untouched = mapPostRow(postRow(), "u1", ANON_NAME_FALLBACK, TOPICS, new Set());
  expect(untouched.reactionCount).toBe(0);
  expect(untouched.hasReacted).toBe(false);
  expect(untouched.lastReactorName).toBeNull();
});

it("mapPostRow applies transformPost with the mapped post and the raw row", () => {
  const row = postRow({ id: "p9" });
  const post = mapPostRow(
    row,
    "u1",
    ANON_NAME_FALLBACK,
    TOPICS,
    new Set(),
    undefined,
    undefined,
    (p, r) => ({ ...p, likeCount: p.likeCount + (Number(r.seed_likes) || 0) }),
  );
  // `seed_likes` isn't on PostRow — a host's extraPostColumns land untyped on
  // the raw row, which is exactly what transformPost is handed.
  expect(post.likeCount).toBe(3); // no seed_likes key on the row -> Number(undefined) || 0
  expect(post.id).toBe("p9");

  const withSeed = mapPostRow(
    { ...row, seed_likes: 7 } as unknown as PostRow,
    "u1",
    ANON_NAME_FALLBACK,
    TOPICS,
    new Set(),
    undefined,
    undefined,
    (p, r) => ({ ...p, likeCount: p.likeCount + (Number(r.seed_likes) || 0) }),
  );
  expect(withSeed.likeCount).toBe(10); // row.likes[0].count (3) + seed_likes (7)
});

it("mapPostRow leaves the post unchanged when transformPost is absent", () => {
  const withoutTransform = mapPostRow(postRow(), "u1", ANON_NAME_FALLBACK, TOPICS, new Set());
  const withUndefinedTransform = mapPostRow(
    postRow(),
    "u1",
    ANON_NAME_FALLBACK,
    TOPICS,
    new Set(),
    undefined,
    undefined,
    undefined,
  );
  expect(withUndefinedTransform).toEqual(withoutTransform);
});

it("newestCreatedAt finds the max even when a pinned post sits first", () => {
  const posts = [
    { createdAt: "2026-07-01T00:00:00Z" }, // old pinned post floated to the top
    { createdAt: "2026-07-19T10:00:00Z" },
    { createdAt: "2026-07-18T10:00:00Z" },
  ];
  expect(newestCreatedAt(posts)).toBe("2026-07-19T10:00:00Z");
  expect(newestCreatedAt([])).toBeNull();
});

it("mapCommentRow maps author name and ownership", () => {
  const row: CommentRow = {
    id: "c1",
    post_id: "p1",
    author_id: "u9",
    content: "amen",
    status: "visible",
    created_at: "2026-07-08T11:00:00Z",
    profiles: { username: null, is_official: null, handle: null, avatar_url: null },
  };
  const comment = mapCommentRow(row, "u1", ANON_NAME_FALLBACK);
  expect(comment).toEqual({
    id: "c1",
    postId: "p1",
    authorId: "u9",
    authorName: ANON_NAME_FALLBACK,
    authorOfficial: false,
    authorHandle: null,
    authorAvatarUrl: null,
    text: "amen",
    isOwn: false,
    createdAt: "2026-07-08T11:00:00Z",
  });
});

it("mapPostRow without poll options has no poll", () => {
  expect(mapPostRow(postRow(), "u1", ANON_NAME_FALLBACK, TOPICS, new Set()).poll).toBeNull();
});

it("mapPostRow assembles the poll in idx order with counts and my vote", () => {
  const row = postRow({
    poll_options: [
      { id: "o2", idx: 1, label: "No" },
      { id: "o1", idx: 0, label: "Yes" },
    ],
  });
  const post = mapPostRow(row, "u2", ANON_NAME_FALLBACK, TOPICS, new Set(), {
    counts: new Map([
      ["o1", 4],
      ["o2", 1],
    ]),
    myVotes: new Map([["p1", "o2"]]),
  });
  expect(post.poll).toEqual({
    options: [
      { id: "o1", label: "Yes", votes: 4 },
      { id: "o2", label: "No", votes: 1 },
    ],
    myOptionId: "o2",
    totalVotes: 5,
  });
});

it("mapPostRow defaults poll data to empty (no votes, not voted)", () => {
  const row = postRow({ poll_options: [{ id: "o1", idx: 0, label: "Yes" }] });
  const post = mapPostRow(row, "u1", ANON_NAME_FALLBACK, TOPICS, new Set());
  expect(post.poll).toEqual({
    options: [{ id: "o1", label: "Yes", votes: 0 }],
    myOptionId: null,
    totalVotes: 0,
  });
});

it("buildPoll returns null for a post without options", () => {
  expect(buildPoll([], new Map(), null)).toBeNull();
});

it("applyPollVote counts a first vote and grows the total", () => {
  const post = mapPostRow(
    postRow({
      poll_options: [
        { id: "o1", idx: 0, label: "Yes" },
        { id: "o2", idx: 1, label: "No" },
      ],
    }),
    "u2",
    ANON_NAME_FALLBACK,
    TOPICS,
    new Set(),
    { counts: new Map([["o1", 2]]), myVotes: new Map() },
  );
  const voted = applyPollVote(post, "p1", "o2");
  expect(voted.poll).toEqual({
    options: [
      { id: "o1", label: "Yes", votes: 2 },
      { id: "o2", label: "No", votes: 1 },
    ],
    myOptionId: "o2",
    totalVotes: 3,
  });
});

it("applyPollVote moves an existing vote without changing the total", () => {
  const post = mapPostRow(
    postRow({
      poll_options: [
        { id: "o1", idx: 0, label: "Yes" },
        { id: "o2", idx: 1, label: "No" },
      ],
    }),
    "u2",
    ANON_NAME_FALLBACK,
    TOPICS,
    new Set(),
    { counts: new Map([["o1", 2]]), myVotes: new Map([["p1", "o1"]]) },
  );
  const moved = applyPollVote(post, "p1", "o2");
  expect(moved.poll).toEqual({
    options: [
      { id: "o1", label: "Yes", votes: 1 },
      { id: "o2", label: "No", votes: 1 },
    ],
    myOptionId: "o2",
    totalVotes: 2,
  });
  // Re-tapping my current option is a no-op (same object back).
  expect(applyPollVote(moved, "p1", "o2")).toBe(moved);
});

it("applyPollVote ignores other posts and poll-less posts", () => {
  const plain = mapPostRow(postRow(), "u1", ANON_NAME_FALLBACK, TOPICS, new Set());
  expect(applyPollVote(plain, "p1", "o1")).toBe(plain);
  const withPoll = mapPostRow(
    postRow({ poll_options: [{ id: "o1", idx: 0, label: "Yes" }] }),
    "u1",
    ANON_NAME_FALLBACK,
    TOPICS,
    new Set(),
  );
  expect(applyPollVote(withPoll, "other-post", "o1")).toBe(withPoll);
});

it("pollPercent rounds and survives zero totals", () => {
  expect(pollPercent(1, 3)).toBe(33);
  expect(pollPercent(2, 3)).toBe(67);
  expect(pollPercent(0, 0)).toBe(0);
  expect(pollPercent(5, 5)).toBe(100);
});

it("applyReaction increments count and marks reacted, idempotent", () => {
  const post = makePost({ reactionCount: 2, hasReacted: false });
  const once = applyReaction(post);
  expect(once.reactionCount).toBe(3);
  expect(applyReaction(once)).toEqual(once);
});

it("applyReaction leaves other fields untouched", () => {
  const post = makePost({ reactionCount: 0, hasReacted: false, likeCount: 5 });
  expect(applyReaction(post)).toEqual({ ...post, reactionCount: 1, hasReacted: true });
});

it("newPostsLabel pluralizes", () => {
  expect(newPostsLabel(1)).toBe("1 new post");
  expect(newPostsLabel(3)).toBe("3 new posts");
});

it("mapProfileRow maps names, flags and nullables", () => {
  const profile = mapProfileRow(
    {
      id: "u1",
      username: "Hannah",
      handle: "hannah-4031",
      is_official: null,
      bio: "Walking in faith.",
      avatar_url: null,
    },
    ANON_NAME_FALLBACK,
  );
  expect(profile).toEqual({
    id: "u1",
    name: "Hannah",
    handle: "hannah-4031",
    official: false,
    bio: "Walking in faith.",
    avatarUrl: null,
    username: "Hannah",
  });
  expect(
    mapProfileRow(
      {
        id: "u2",
        username: null,
        handle: null,
        is_official: true,
        bio: null,
        avatar_url: "https://cdn.example/a.jpg",
      },
      ANON_NAME_FALLBACK,
    ),
  ).toEqual({
    id: "u2",
    name: ANON_NAME_FALLBACK,
    handle: null,
    official: true,
    bio: null,
    avatarUrl: "https://cdn.example/a.jpg",
    username: null,
  });
});
