// Cache-reading helpers behind `ThreadSheet`'s `useCachedPost`: finding a
// post across every paginated list cache that can hold one, and subscribing
// to exactly the cache events that can change that answer. Pulled out of
// `ThreadSheet.tsx` into their own file (no react-native/expo import here) so
// this logic can be unit-tested directly with plain vitest, without needing
// to mock React Native, reanimated, expo-image or expo-haptics — everything
// else that screen imports.
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { FeedPost } from "@rocapine/community-core";

/** Finds a `FeedPost` by id across every cache that can hold one — the topic
 * feeds, user-posts and search results, all paginated `InfiniteData` —
 * mirroring the set of caches `useReactToPost`/`useVotePoll` sweep in
 * `core/hooks.ts`. */
export function findCachedPost(queryClient: QueryClient, postId: string): FeedPost | null {
  const entries = [
    ...queryClient.getQueriesData<InfiniteData<FeedPost[]>>({ queryKey: ["community", "feed"] }),
    ...queryClient.getQueriesData<InfiniteData<FeedPost[]>>({
      queryKey: ["community", "userPosts"],
    }),
    ...queryClient.getQueriesData<InfiniteData<FeedPost[]>>({ queryKey: ["community", "search"] }),
  ];
  for (const [, data] of entries) {
    if (!data) continue;
    for (const page of data.pages) {
      const found = page.find((p) => p.id === postId);
      if (found) return found;
    }
  }
  return null;
}

/** Subscribes only to the caches `findCachedPost` actually reads (feed /
 * userPosts / search) — explicitly skipping `["community", "thread", ...]`
 * events, i.e. `ThreadSheet`'s own `useThread(postId)` query. That exclusion
 * is the fix for a real bug: an earlier version of `useCachedPost`
 * subscribed to every `["community", ...]` cache event unconditionally,
 * which included `useThread`'s own query. Opening a thread makes `useThread`
 * transition loading→success (and its comments query keeps emitting cache
 * events for its own internal bookkeeping), each of which used to call an
 * unconditional `forceUpdate`, re-rendering `ThreadSheet`, which re-invokes
 * `useThread`, which emits more cache events — a `queryCache` event ⇄ render
 * loop bounded only by React's "Maximum update depth exceeded" safety net
 * (confirmed 22 iterations in one thread open via a simulator QA session's
 * log registry). `useCachedPost` (in `ThreadSheet.tsx`) additionally reads
 * this via `useSyncExternalStore`, so even a `feed`/`userPosts`/`search`
 * event that doesn't actually change the found post causes no re-render —
 * this function only needs to avoid notifying for events that can *never*
 * change `findCachedPost`'s answer. */
export function subscribeToPostListCaches(
  queryClient: QueryClient,
  postId: string | null,
  onStoreChange: () => void,
): () => void {
  // Gated on `postId !== null`: `ThreadSheet` is mounted by its host for its
  // entire lifetime (postId flips between a value and `null`, the component
  // itself never unmounts), so an unconditional subscription here would
  // listen to the whole shared `QueryClient` — every query any other feature
  // in the host app runs — for as long as the sheet has never been opened.
  if (!postId) return () => {};
  return queryClient.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey;
    if (key[0] !== "community") return;
    if (key[1] === "thread") return;
    onStoreChange();
  });
}
