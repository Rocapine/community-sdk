// Regression coverage for the real "Maximum update depth exceeded" bug found
// in live simulator QA (see ThreadSheet.tsx's useCachedPost doc comment):
// `subscribeToPostListCaches` used to notify on every `["community", ...]`
// cache event, including the thread's own `useThread(postId)` query — which,
// paired with an unconditional `forceUpdate`, produced an event ⇄ render
// loop. These tests simulate a fake `QueryClient`'s cache events directly
// (no React, no react-native — this module has neither as a dependency) and
// assert the subscription both ignores `thread` events and finds posts
// correctly across every cache `findCachedPost` reads.
import { describe, expect, it, vi } from "vitest";
import type { FeedPost } from "@rocapine/community-core";
import { findCachedPost, subscribeToPostListCaches } from "../utils/postCache";

/** Minimal fake shaped like the slice of `QueryClient` these helpers use:
 * `getQueryCache().subscribe(listener)` and `getQueriesData(filter)`. Real
 * enough to drive both functions without importing `@tanstack/react-query`'s
 * actual `QueryClient` (which would need a real cache/store behind it). */
function makeFakeQueryClient(entries: Array<[readonly unknown[], unknown]> = []) {
  const listeners: Array<(event: { query: { queryKey: readonly unknown[] } }) => void> = [];
  return {
    client: {
      getQueryCache: () => ({
        subscribe: (listener: (event: { query: { queryKey: readonly unknown[] } }) => void) => {
          listeners.push(listener);
          return () => {
            const i = listeners.indexOf(listener);
            if (i >= 0) listeners.splice(i, 1);
          };
        },
      }),
      getQueriesData: ({ queryKey }: { queryKey: readonly unknown[] }) =>
        entries.filter(([key]) => key[0] === queryKey[0] && key[1] === queryKey[1]),
    } as any,
    emit: (queryKey: readonly unknown[]) => {
      for (const listener of listeners) listener({ query: { queryKey } });
    },
    listenerCount: () => listeners.length,
  };
}

function fakePost(id: string): FeedPost {
  return { id } as unknown as FeedPost;
}

function infiniteData(posts: FeedPost[]) {
  return { pages: [posts], pageParams: [undefined] };
}

describe("findCachedPost", () => {
  it("finds a post in the feed cache", () => {
    const post = fakePost("p1");
    const { client } = makeFakeQueryClient([
      [["community", "feed", "general"], infiniteData([post])],
    ]);
    expect(findCachedPost(client, "p1")).toBe(post);
  });

  it("finds a post in the userPosts cache", () => {
    const post = fakePost("p2");
    const { client } = makeFakeQueryClient([
      [["community", "userPosts", "u1"], infiniteData([post])],
    ]);
    expect(findCachedPost(client, "p2")).toBe(post);
  });

  it("finds a post in the search cache", () => {
    const post = fakePost("p3");
    const { client } = makeFakeQueryClient([
      [["community", "search", "hello"], infiniteData([post])],
    ]);
    expect(findCachedPost(client, "p3")).toBe(post);
  });

  it("returns null when the post is in no cache", () => {
    const { client } = makeFakeQueryClient([
      [["community", "feed", "general"], infiniteData([fakePost("other")])],
    ]);
    expect(findCachedPost(client, "missing")).toBeNull();
  });

  it("never reads the thread cache (not one of the lists it sweeps)", () => {
    const { client } = makeFakeQueryClient([
      [["community", "thread", "p1"], [fakePost("p1")]], // wrong shape on purpose
    ]);
    // Would throw on `.pages` if this ever got read as an InfiniteData list;
    // returning null proves the thread key was never queried.
    expect(findCachedPost(client, "p1")).toBeNull();
  });
});

describe("subscribeToPostListCaches", () => {
  it("returns a no-op unsubscribe and never notifies when postId is null", () => {
    const { client, listenerCount } = makeFakeQueryClient();
    const onStoreChange = vi.fn();
    const unsubscribe = subscribeToPostListCaches(client, null, onStoreChange);
    expect(listenerCount()).toBe(0);
    expect(() => unsubscribe()).not.toThrow();
    expect(onStoreChange).not.toHaveBeenCalled();
  });

  it("notifies on a feed/userPosts/search cache event", () => {
    const { client, emit } = makeFakeQueryClient();
    const onStoreChange = vi.fn();
    subscribeToPostListCaches(client, "p1", onStoreChange);

    emit(["community", "feed", "general"]);
    emit(["community", "userPosts", "u1"]);
    emit(["community", "search", "hello"]);

    expect(onStoreChange).toHaveBeenCalledTimes(3);
  });

  it("ignores this screen's own thread query — the exact cause of the infinite-loop bug", () => {
    const { client, emit } = makeFakeQueryClient();
    const onStoreChange = vi.fn();
    subscribeToPostListCaches(client, "p1", onStoreChange);

    // Simulate the event storm a real thread open produced (22 events, per
    // the QA log registry) purely from `useThread`'s own query lifecycle.
    for (let i = 0; i < 22; i++) {
      emit(["community", "thread", "p1"]);
    }

    expect(onStoreChange).not.toHaveBeenCalled();
  });

  it("ignores cache events outside the community namespace", () => {
    const { client, emit } = makeFakeQueryClient();
    const onStoreChange = vi.fn();
    subscribeToPostListCaches(client, "p1", onStoreChange);

    emit(["someOtherFeature", "list"]);

    expect(onStoreChange).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const { client, emit } = makeFakeQueryClient();
    const onStoreChange = vi.fn();
    const unsubscribe = subscribeToPostListCaches(client, "p1", onStoreChange);
    unsubscribe();

    emit(["community", "feed", "general"]);

    expect(onStoreChange).not.toHaveBeenCalled();
  });
});
