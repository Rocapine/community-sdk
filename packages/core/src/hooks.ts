// React Query hooks over the community service — the primary consumer-facing API of this
// package. Every hook threads `cfg = useCommunityConfig()` through to the service layer and
// to `emitEvent`, and every query is gated on `cfg.supabase !== null` so a host that never
// configured a backend degrades to "always empty / never loading forever" instead of
// throwing inside a render.
//
// Ported from the mold (`sdk/client/hooks/useCommunity.ts`) with a host app's newer
// generalized reaction feature (`usePrayForPost` -> `useReactToPost`, optimistic
// `applyReaction`) and unseen-count hook (parameterized on `lastSeenAtIso` instead of
// reading that host's own store). No React Native / analytics-SDK / store imports here.

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { COMMUNITY_EVENTS, emitEvent } from "./events";
import { ensureIdentity } from "./identity";
import {
  applyPollVote,
  applyReaction,
  FEED_PAGE_SIZE,
  type CommunityProfile,
  type FeedPost,
  type ThreadComment,
} from "./models";
import { useCommunityConfig } from "./provider";
import {
  blockUser,
  countNewPosts,
  createComment,
  createPost,
  deleteOwnComment,
  deleteOwnPost,
  fetchFeedPage,
  fetchProfile,
  fetchThread,
  fetchUserPosts,
  moderateOne,
  reportContent,
  searchPosts,
  setLike,
  setReaction,
  updateProfile,
  votePoll,
  type ModerationVerdict,
  type ReportInput,
  type UpdateProfileInput,
  type UpdateProfileResult,
} from "./service";

const FEED_KEY = ["community", "feed"] as const;
const feedKey = (topic?: string) => [...FEED_KEY, topic ?? "all"] as const;
const threadKey = (postId: string) => ["community", "thread", postId] as const;
const profileKey = (userId: string) => ["community", "profile", userId] as const;
const userPostsKey = (userId: string) => ["community", "userPosts", userId] as const;
const USER_POSTS_KEY = ["community", "userPosts"] as const;
const SEARCH_KEY = ["community", "search"] as const;

/**
 * Adjust a post's commentCount across every cached feed page (all topic
 * filters). The feed is never refetched after commenting (kept smooth), so the
 * badge only tracks new comments if we reconcile the cache in place. Scoped to
 * the feed only (matching the mold and the newer host's source) — a comment count
 * change is not reflected in the user-posts/search caches, same as upstream.
 */
function bumpFeedCommentCount(queryClient: QueryClient, postId: string, delta: number): void {
  queryClient.setQueriesData<InfiniteData<FeedPost[]>>({ queryKey: FEED_KEY }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) =>
            page.map((post) =>
              post.id === postId
                ? { ...post, commentCount: Math.max(0, post.commentCount + delta) }
                : post,
            ),
          ),
        }
      : data,
  );
}

type PostCacheEntry = [readonly unknown[], InfiniteData<FeedPost[]> | undefined];

/**
 * Snapshot of every post-holding cache, for optimistic-update rollback on
 * error. The feed, user-posts and search caches are all `InfiniteData` now
 * that user-posts and search are paginated like the feed — one flat list of
 * entries instead of the feed/flat split this needed before.
 */
interface PostCacheSnapshot {
  entries: PostCacheEntry[];
}

/**
 * Apply `mapPost` optimistically across every cache that can hold a
 * `FeedPost`: the topic feeds, user-posts and search results (all
 * `InfiniteData<FeedPost[]>`). Returns a snapshot for `rollbackPostCaches` on
 * error. Used by `useVotePoll` and `useReactToPost`, the two mutations whose
 * optimistic update must be visible from any screen that renders a
 * `FeedPost` (mirrors the mold's `POST_PAGES_KEYS` sweep).
 */
async function applyOptimisticToAllPostCaches(
  queryClient: QueryClient,
  mapPost: (post: FeedPost) => FeedPost,
): Promise<PostCacheSnapshot> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: FEED_KEY }),
    queryClient.cancelQueries({ queryKey: USER_POSTS_KEY }),
    queryClient.cancelQueries({ queryKey: SEARCH_KEY }),
  ]);
  const entries: PostCacheEntry[] = [
    ...queryClient.getQueriesData<InfiniteData<FeedPost[]>>({ queryKey: FEED_KEY }),
    ...queryClient.getQueriesData<InfiniteData<FeedPost[]>>({ queryKey: USER_POSTS_KEY }),
    ...queryClient.getQueriesData<InfiniteData<FeedPost[]>>({ queryKey: SEARCH_KEY }),
  ];
  const applyToPages = (data: InfiniteData<FeedPost[]> | undefined) =>
    data ? { ...data, pages: data.pages.map((page) => page.map(mapPost)) } : data;
  queryClient.setQueriesData<InfiniteData<FeedPost[]>>({ queryKey: FEED_KEY }, applyToPages);
  queryClient.setQueriesData<InfiniteData<FeedPost[]>>({ queryKey: USER_POSTS_KEY }, applyToPages);
  queryClient.setQueriesData<InfiniteData<FeedPost[]>>({ queryKey: SEARCH_KEY }, applyToPages);
  return { entries };
}

function rollbackPostCaches(queryClient: QueryClient, snapshot: PostCacheSnapshot): void {
  for (const [key, data] of snapshot.entries) queryClient.setQueryData(key, data);
}

/**
 * One infinite-scrolling feed, newest (then pinned) first. `enabled` is kept
 * beyond the brief's literal `(topic?)` signature (both source apps take it,
 * e.g. to pause the feed query while an in-progress search query is active) —
 * defaults to `true` so `useCommunityFeed(topic)` still matches the brief.
 */
export function useCommunityFeed(topic?: string, enabled = true) {
  const cfg = useCommunityConfig();
  return useInfiniteQuery({
    queryKey: feedKey(topic),
    queryFn: ({ pageParam }) => fetchFeedPage(cfg, { topic, cursor: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage: FeedPost[], pages: FeedPost[][]) =>
      lastPage.length === FEED_PAGE_SIZE ? pages.length : undefined,
    enabled: cfg.supabase !== null && enabled,
    staleTime: 1000 * 30,
    retry: 1,
  });
}

/**
 * Search visible posts by content, infinite-scrolling like the feed.
 * Enabled once the term has >= 2 chars.
 */
export function useSearchPosts(term: string) {
  const cfg = useCommunityConfig();
  const cleaned = term.trim();
  return useInfiniteQuery({
    queryKey: [...SEARCH_KEY, cleaned],
    queryFn: ({ pageParam }) => searchPosts(cfg, cleaned, { cursor: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage: FeedPost[], pages: FeedPost[][]) =>
      lastPage.length === FEED_PAGE_SIZE ? pages.length : undefined,
    enabled: cfg.supabase !== null && cleaned.length >= 2,
    staleTime: 1000 * 30,
    retry: 1,
  });
}

/**
 * Polls (5s, while `polling`) for posts newer than the loaded top. `topic`
 * and `polling` are kept beyond the brief's literal `(sinceIso)` signature
 * (both source apps take them, needed for a topic-filtered "N new posts" pill —
 * see Task 5's same call on `countNewPosts`) — both default so
 * `useNewPostsCount(sinceIso)` still matches the brief.
 */
export function useNewPostsCount(sinceIso: string | null, topic?: string, polling = true): number {
  const cfg = useCommunityConfig();
  const q = useQuery({
    queryKey: ["community", "newCount", topic ?? "all", sinceIso],
    queryFn: () => countNewPosts(cfg, sinceIso!, topic),
    enabled: cfg.supabase !== null && !!sinceIso && polling,
    refetchInterval: polling ? 5000 : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  return q.data ?? 0;
}

/**
 * Number of posts by others since the community was last opened (0 while
 * loading/failing) — feeds a host's Community tab badge. Takes `lastSeenAtIso`
 * as a parameter instead of reading a host's "last seen" store directly (the
 * mold read a host-seam function, the newer host read its own store — this
 * package has no store access at all, so the host now owns that value and
 * passes it in).
 */
export function useCommunityUnseenCount(lastSeenAtIso: string | null): number {
  const cfg = useCommunityConfig();
  const q = useQuery({
    queryKey: ["community", "unseen", lastSeenAtIso ?? "never"],
    queryFn: () => countNewPosts(cfg, lastSeenAtIso ?? "1970-01-01T00:00:00Z"),
    enabled: cfg.supabase !== null,
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 120,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  return q.data ?? 0;
}

export function useThread(postId: string | null) {
  const cfg = useCommunityConfig();
  return useQuery<ThreadComment[]>({
    queryKey: threadKey(postId ?? "none"),
    queryFn: () => fetchThread(cfg, postId!),
    enabled: cfg.supabase !== null && !!postId,
    staleTime: 1000 * 15,
    retry: 1,
  });
}

export function useProfile(userId: string | null) {
  const cfg = useCommunityConfig();
  return useQuery<CommunityProfile>({
    queryKey: profileKey(userId ?? "none"),
    queryFn: () => fetchProfile(cfg, userId!),
    enabled: cfg.supabase !== null && !!userId,
    staleTime: 1000 * 30,
    retry: 1,
  });
}

/**
 * One user's posts, newest first, infinite-scrolling like the feed.
 */
export function useUserPosts(userId: string | null) {
  const cfg = useCommunityConfig();
  return useInfiniteQuery({
    queryKey: userPostsKey(userId ?? "none"),
    queryFn: ({ pageParam }) => fetchUserPosts(cfg, userId!, { cursor: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage: FeedPost[], pages: FeedPost[][]) =>
      lastPage.length === FEED_PAGE_SIZE ? pages.length : undefined,
    enabled: cfg.supabase !== null && !!userId,
    staleTime: 1000 * 30,
    retry: 1,
  });
}

/** Our own stable community uid, resolved once and cached for the app session. */
export function useMyUid(): string | null {
  const cfg = useCommunityConfig();
  const q = useQuery({
    queryKey: ["community", "myUid"],
    queryFn: () => ensureIdentity(cfg),
    enabled: cfg.supabase !== null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return q.data ?? null;
}

/** Profile edits refresh everything derived from a profile row: the profile
 * itself, plus the handle/avatar shown on every cached feed and thread. */
export function useUpdateProfile() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation<UpdateProfileResult, Error, UpdateProfileInput>({
    mutationFn: (input) => updateProfile(cfg, input),
    onSuccess: (result, input) => {
      if (result.status !== "ok") return;
      queryClient.invalidateQueries({ queryKey: ["community"] });
      emitEvent(cfg, COMMUNITY_EVENTS.profileUpdated, {
        hasBio: !!input.bio,
        hasAvatar: !!input.avatarUrl,
        handleChanged: !!input.handle,
      });
    },
  });
}

type PostResult = { id: string; verdict: ModerationVerdict };

/**
 * Optimistic post creation with NO refetch: the post shows instantly, and after
 * moderation we reconcile the cache in place, published -> swap the temp id for
 * the real one (stays), rejected -> remove it. Smooth, no loading flicker.
 */
export function useCreatePost() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation<
    PostResult,
    Error,
    { topic: string; text: string; authorName: string; pollOptions?: string[] },
    { tempId: string }
  >({
    onMutate: async ({ topic, text, authorName, pollOptions }) => {
      await queryClient.cancelQueries({ queryKey: FEED_KEY });
      const tempId = `optimistic-${Date.now()}`;
      const optimistic: FeedPost = {
        id: tempId,
        authorId: "",
        authorName,
        authorOfficial: false,
        authorHandle: null,
        authorAvatarUrl: null,
        topic,
        text,
        status: "visible",
        likeCount: 0,
        commentCount: 0,
        likedByMe: false,
        isOwn: true,
        createdAt: new Date().toISOString(),
        pinnedAt: null,
        // Temp option ids: PollBlock refuses votes on them; the post-publish
        // refetch below swaps in the real uuids.
        poll:
          pollOptions && pollOptions.length > 0
            ? {
                options: pollOptions.map((label, i) => ({ id: `temp-${i}`, label, votes: 0 })),
                myOptionId: null,
                totalVotes: 0,
              }
            : null,
        reactionCount: 0,
        hasReacted: false,
        lastReactorName: null,
      };
      const prepend = (key: readonly unknown[]) =>
        queryClient.setQueryData<InfiniteData<FeedPost[]>>(key, (d) =>
          d ? { ...d, pages: [[optimistic, ...(d.pages[0] ?? [])], ...d.pages.slice(1)] } : d,
        );
      prepend(feedKey(undefined));
      prepend(feedKey(topic));
      return { tempId };
    },
    mutationFn: async ({ topic, text, pollOptions }) => {
      const id = await createPost(cfg, { topic, body: text, pollOptions });
      const verdict = await moderateOne(cfg, { kind: "post", id });
      return { id, verdict };
    },
    onSuccess: ({ id, verdict }, { topic, text, pollOptions }, { tempId }) => {
      const rejected = verdict.status === "rejected";
      queryClient.setQueriesData<InfiniteData<FeedPost[]>>({ queryKey: FEED_KEY }, (d) =>
        d
          ? {
              ...d,
              pages: d.pages.map((p) =>
                rejected
                  ? p.filter((post) => post.id !== tempId)
                  : p.map((post) =>
                      post.id === tempId ? { ...post, id, status: "visible" } : post,
                    ),
              ),
            }
          : d,
      );
      if (verdict.status === "published") {
        const hasPoll = !!pollOptions && pollOptions.length > 0;
        emitEvent(cfg, COMMUNITY_EVENTS.postPublished, {
          topic,
          bodyLength: text.trim().length,
          hasPoll,
        });
        cfg.host.onContentPublished();
        // The in-place swap above keeps the optimistic poll's temp option ids;
        // voting needs the real uuids, so a poll post refetches in background.
        if (hasPoll) queryClient.invalidateQueries({ queryKey: FEED_KEY });
      }
    },
    onError: (_e, _v, context) => {
      queryClient.setQueriesData<InfiniteData<FeedPost[]>>({ queryKey: FEED_KEY }, (d) =>
        d
          ? { ...d, pages: d.pages.map((p) => p.filter((post) => post.id !== context?.tempId)) }
          : d,
      );
    },
  });
}

/** Optimistic comment creation, same reconcile-in-place model as posts. */
export function useCreateComment() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation<
    PostResult,
    Error,
    { postId: string; text: string; authorName: string },
    { tempId: string }
  >({
    onMutate: async ({ postId, text, authorName }) => {
      await queryClient.cancelQueries({ queryKey: threadKey(postId) });
      await queryClient.cancelQueries({ queryKey: FEED_KEY });
      const tempId = `optimistic-${Date.now()}`;
      const optimistic: ThreadComment = {
        id: tempId,
        postId,
        authorId: "",
        authorName,
        authorOfficial: false,
        authorHandle: null,
        authorAvatarUrl: null,
        text,
        isOwn: true,
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData<ThreadComment[]>(threadKey(postId), (d) => [
        ...(d ?? []),
        optimistic,
      ]);
      bumpFeedCommentCount(queryClient, postId, 1);
      return { tempId };
    },
    mutationFn: async ({ postId, text }) => {
      const id = await createComment(cfg, postId, text);
      const verdict = await moderateOne(cfg, { kind: "comment", id });
      return { id, verdict };
    },
    onSuccess: ({ id, verdict }, { postId, text }, { tempId }) => {
      const rejected = verdict.status === "rejected";
      queryClient.setQueryData<ThreadComment[]>(threadKey(postId), (d) =>
        (d ?? [])
          .filter((c) => !(rejected && c.id === tempId))
          .map((c) => (c.id === tempId ? { ...c, id } : c)),
      );
      // A rejected comment never becomes visible, so undo the optimistic bump.
      if (rejected) bumpFeedCommentCount(queryClient, postId, -1);
      if (verdict.status === "published") {
        emitEvent(cfg, COMMUNITY_EVENTS.commentPublished, {
          postId,
          bodyLength: text.trim().length,
        });
        cfg.host.onContentPublished();
      }
    },
    onError: (_e, { postId }, context) => {
      queryClient.setQueryData<ThreadComment[]>(threadKey(postId), (d) =>
        (d ?? []).filter((c) => c.id !== context?.tempId),
      );
      bumpFeedCommentCount(queryClient, postId, -1);
    },
  });
}

/** Optimistic like toggle across all cached feed pages (every topic filter). */
export function useToggleLike() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, liked }: { postId: string; liked: boolean; topic: string | null }) =>
      setLike(cfg, postId, liked),
    onMutate: async ({ postId, liked }) => {
      await queryClient.cancelQueries({ queryKey: FEED_KEY });
      const previous = queryClient.getQueriesData<InfiniteData<FeedPost[]>>({
        queryKey: FEED_KEY,
      });
      queryClient.setQueriesData<InfiniteData<FeedPost[]>>({ queryKey: FEED_KEY }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) =>
                page.map((post) =>
                  post.id === postId
                    ? {
                        ...post,
                        likedByMe: liked,
                        likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)),
                      }
                    : post,
                ),
              ),
            }
          : data,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (_data, { liked, postId, topic }) => {
      if (liked) emitEvent(cfg, COMMUNITY_EVENTS.postLiked, { postId, topic });
    },
  });
}

/**
 * Optimistic poll vote across every post cache (mirror of useToggleLike, but
 * reaching the user-posts/search caches too — see `applyOptimisticToAllPostCaches`).
 * `optionId` is the poll option's row id (Task 5 ruling), not a numeric index —
 * the brief's `optionIndex` naming is dropped since neither `votePoll` nor
 * `applyPollVote` operate on one.
 */
export function useVotePoll() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, optionId }: { postId: string; optionId: string }) =>
      votePoll(cfg, postId, optionId),
    onMutate: ({ postId, optionId }) =>
      applyOptimisticToAllPostCaches(queryClient, (post) => applyPollVote(post, postId, optionId)),
    onError: (_err, _vars, context) => {
      if (context) rollbackPostCaches(queryClient, context);
    },
    onSuccess: (_data, { postId, optionId }) => {
      emitEvent(cfg, COMMUNITY_EVENTS.pollVoted, { postId, optionId });
    },
  });
}

/**
 * Optimistic reaction across every post cache (mirror of useVotePoll; renamed
 * from the mold's `usePrayForPost`). `applyReaction(post)` is single-argument
 * (Task 3 ruling — it does not filter by post id), so the mapper here pre-filters
 * to the target post itself before calling it, and separately tracks whether
 * that post already had `hasReacted` so a retap of an already-reacted post
 * (the reaction is non-retractable, `setReaction` is idempotent) does not
 * re-emit the analytics event.
 */
export function useReactToPost() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { postId: string },
    PostCacheSnapshot & { alreadyReacted: boolean }
  >({
    mutationFn: ({ postId }) => setReaction(cfg, postId),
    onMutate: async ({ postId }) => {
      let alreadyReacted = false;
      const snapshot = await applyOptimisticToAllPostCaches(queryClient, (post) => {
        if (post.id !== postId) return post;
        if (post.hasReacted) alreadyReacted = true;
        return applyReaction(post);
      });
      return { ...snapshot, alreadyReacted };
    },
    onError: (_err, _vars, context) => {
      if (context) rollbackPostCaches(queryClient, context);
    },
    onSuccess: (_data, { postId }, context) => {
      if (!context?.alreadyReacted) emitEvent(cfg, COMMUNITY_EVENTS.reactionAdded, { postId });
    },
  });
}

export function useReport() {
  const cfg = useCommunityConfig();
  return useMutation({
    mutationFn: (input: ReportInput) => reportContent(cfg, input),
    onSuccess: (_data, input) => {
      emitEvent(cfg, COMMUNITY_EVENTS.userReported, {
        reason: input.reason,
        contentType: input.postId ? "post" : "comment",
      });
    },
  });
}

/** Blocking re-filters everything: drop every community cache and refetch. */
export function useBlockUser() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId }: { userId: string }) => blockUser(cfg, userId),
    onSuccess: () => {
      emitEvent(cfg, COMMUNITY_EVENTS.userBlocked);
      queryClient.invalidateQueries({ queryKey: ["community"] });
    },
  });
}

export function useDeleteContent() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id }: { kind: "post" | "comment"; id: string; postId: string }) =>
      kind === "post" ? deleteOwnPost(cfg, id) : deleteOwnComment(cfg, id),
    onSuccess: (_data, { kind, postId }) => {
      emitEvent(cfg, COMMUNITY_EVENTS.contentDeleted, { contentType: kind });
      queryClient.invalidateQueries({ queryKey: threadKey(postId) });
      queryClient.invalidateQueries({ queryKey: FEED_KEY });
    },
  });
}
