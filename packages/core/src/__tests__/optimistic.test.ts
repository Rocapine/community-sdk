// Optimistic rows carry our own uid/avatar (so tapping our just-sent post
// opens our profile, not an empty-id route), and `isOptimistic` is the marker
// server-keyed actions wait on now that `authorId` is no longer "".
import { MutationObserver, QueryClient, type InfiniteData } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import {
  createCommentMutationOptions,
  createPostMutationOptions,
  isOptimistic,
  ownAuthorFields,
} from "../hooks";
import { feedKey, threadKey } from "../keys";
import type { FeedPost, ThreadComment } from "../models";
import * as service from "../service";

vi.mock("../service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../service")>()),
  uploadPostImage: vi.fn(),
  createPost: vi.fn(),
  createComment: vi.fn(),
  moderateOne: vi.fn(),
}));

describe("optimistic rows", () => {
  it("fills author fields from the cached uid and profile", () => {
    const qc = new QueryClient();
    qc.setQueryData(["community", "myUid"], "u1");
    qc.setQueryData(["community", "profile", "u1"], {
      id: "u1",
      name: "Ann",
      handle: "ann-1",
      official: false,
      bio: null,
      avatarUrl: "https://x/a.jpg",
    });
    expect(ownAuthorFields(qc)).toEqual({
      authorId: "u1",
      authorHandle: "ann-1",
      authorAvatarUrl: "https://x/a.jpg",
    });
  });

  it("falls back to an empty author before identity resolves", () => {
    expect(ownAuthorFields(new QueryClient())).toEqual({
      authorId: "",
      authorHandle: null,
      authorAvatarUrl: null,
    });
  });

  it("recognizes temp ids only", () => {
    expect(isOptimistic({ id: "optimistic-123" })).toBe(true);
    expect(isOptimistic({ id: "3f2c-uuid" })).toBe(false);
  });
});

describe("create mutations with an image", () => {
  const local = { url: "file:///tmp/a.jpg", width: 800, height: 600 };
  const uploaded = { path: "u1/abc.jpg", width: 800, height: 600 };
  const published = { status: "published" } as service.ModerationVerdict;
  const onEvent = vi.fn();
  const cfg = resolveConfig({
    supabase: null,
    appName: "Test",
    topics: [{ id: "general" }],
    modules: { polls: false, push: false, inbox: false, reaction: false as const, images: true },
    host: { onEvent },
  });
  const calls: string[] = [];
  let qc: QueryClient;

  const seedFeed = () => {
    const data: InfiniteData<FeedPost[]> = { pages: [[], []], pageParams: [0, 1] };
    qc.setQueryData(feedKey(undefined, null), data);
    qc.setQueryData(feedKey("general", null), data);
  };
  const feedIds = () =>
    [feedKey(undefined, null), feedKey("general", null)].map((k) =>
      (qc.getQueryData<InfiniteData<FeedPost[]>>(k)?.pages ?? []).flat().map((p) => p.id),
    );
  const run = <V, R>(options: unknown, vars: V) =>
    new MutationObserver(qc, options as never).mutate(vars as never) as Promise<R>;

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    qc = new QueryClient();
    vi.mocked(service.uploadPostImage).mockImplementation(async () => {
      calls.push("upload");
      return uploaded;
    });
    vi.mocked(service.createPost).mockImplementation(async () => {
      calls.push("create");
      return "p1";
    });
    vi.mocked(service.createComment).mockImplementation(async () => {
      calls.push("create");
      return "c1";
    });
    vi.mocked(service.moderateOne).mockResolvedValue(published);
  });

  const postVars = { topic: "general", text: "", authorName: "Ann", image: local };

  it("uploads the image before inserting the post", async () => {
    seedFeed();
    await run(createPostMutationOptions(cfg, qc, null), postVars);
    expect(calls).toEqual(["upload", "create"]);
    expect(service.uploadPostImage).toHaveBeenCalledWith(cfg, local);
    expect(service.createPost).toHaveBeenCalledWith(cfg, {
      topic: "general",
      body: "",
      pollOptions: undefined,
      image: uploaded,
    });
  });

  it("shows the local image on the optimistic post", async () => {
    seedFeed();
    let seen: FeedPost | undefined;
    vi.mocked(service.uploadPostImage).mockImplementation(async () => {
      seen = qc.getQueryData<InfiniteData<FeedPost[]>>(feedKey(undefined, null))?.pages[0]?.[0];
      return uploaded;
    });
    await run(createPostMutationOptions(cfg, qc, null), postVars);
    expect(seen?.image).toEqual(local);
  });

  it("does not create the post when the upload fails", async () => {
    seedFeed();
    vi.mocked(service.uploadPostImage).mockRejectedValue(new Error("boom"));
    await expect(run(createPostMutationOptions(cfg, qc, null), postVars)).rejects.toThrow("boom");
    expect(service.createPost).not.toHaveBeenCalled();
    expect(feedIds()).toEqual([[], []]);
  });

  it("reports hasImage on postPublished", async () => {
    seedFeed();
    await run(createPostMutationOptions(cfg, qc, null), postVars);
    expect(onEvent).toHaveBeenCalledWith(
      "community_post_published",
      expect.objectContaining({ hasImage: true }),
    );
    await run(createPostMutationOptions(cfg, qc, null), {
      ...postVars,
      text: "hi",
      image: undefined,
    });
    expect(onEvent).toHaveBeenLastCalledWith(
      "community_post_published",
      expect.objectContaining({ hasImage: false, bodyLength: 2 }),
    );
  });

  const commentVars = { postId: "p1", text: "", authorName: "Ann", image: local };
  const seedThread = () => qc.setQueryData<ThreadComment[]>(threadKey("p1", null), []);
  const threadIds = () => qc.getQueryData<ThreadComment[]>(threadKey("p1", null))?.map((c) => c.id);

  it("uploads the image before inserting the comment", async () => {
    seedThread();
    await run(createCommentMutationOptions(cfg, qc, null), commentVars);
    expect(calls).toEqual(["upload", "create"]);
    expect(service.createComment).toHaveBeenCalledWith(cfg, "p1", "", uploaded, undefined);
  });

  it("does not create the comment when the upload fails", async () => {
    seedThread();
    vi.mocked(service.uploadPostImage).mockRejectedValue(new Error("boom"));
    await expect(run(createCommentMutationOptions(cfg, qc, null), commentVars)).rejects.toThrow(
      "boom",
    );
    expect(service.createComment).not.toHaveBeenCalled();
    expect(threadIds()).toEqual([]);
  });

  it("reports hasImage on commentPublished", async () => {
    seedThread();
    await run(createCommentMutationOptions(cfg, qc, null), commentVars);
    expect(onEvent).toHaveBeenCalledWith(
      "community_comment_published",
      expect.objectContaining({ hasImage: true }),
    );
  });
});
