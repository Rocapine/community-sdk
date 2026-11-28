import {
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import {
  CONVERSATIONS_KEY,
  DM_REQUESTS_KEY,
  UNREAD_MESSAGES_KEY,
  GROUPS_SEARCH_KEY,
  groupKey,
  groupMembersKey,
  messagesKey,
} from "../keys";
import {
  accountLinkedQueryOptions,
  afterDelete,
  conversationsQueryOptions,
  createTypingTracker,
  invalidateGroup,
  messagesQueryOptions,
  dmFlagQueryOptions,
  dmRequestsQueryOptions,
  groupsEnabled,
  messagingBadgeQueries,
  requestAnswerMutationOptions,
  startDmMutationOptions,
  messagingBadge,
  peerReadQueryOptions,
  refreshNewestMessages,
  type MessagesData,
  sendMessageMutationOptions,
  unreadMessagesQueryOptions,
  watchDms,
} from "../messaging-hooks";
import * as realtime from "../realtime";
import * as dms from "../dms-service";
import * as service from "../messaging-service";
import { MessagingError, MESSAGES_PAGE_SIZE } from "../messaging-service";
import type { ChatMessage, Conversation } from "../models";

vi.mock("../dms-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dms-service")>()),
  startDm: vi.fn(async () => "c9"),
  declineRequest: vi.fn(async () => {}),
  blockAndReportRequest: vi.fn(async () => {}),
  fetchDmFlags: vi.fn(async (_cfg: unknown, ids: string[]) => ids.filter((id) => id !== "u3")),
}));

vi.mock("../realtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../realtime")>()),
  subscribeDms: vi.fn(() => () => {}),
}));

vi.mock("../messaging-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../messaging-service")>()),
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
}));

const mods = { polls: false, push: false, inbox: false, reaction: false };
const base = { supabase: {} as never, appName: "t", topics: [] };
const on = (onEvent = vi.fn()) =>
  resolveConfig({ ...base, modules: { ...mods, groups: {} }, host: { onEvent } });
const off = resolveConfig({ ...base, modules: mods });

const msg = (id: string, at: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversationId: "c1",
  authorId: "u2",
  body: `body ${id}`,
  imagePath: null,
  attachment: null,
  replyTo: null,
  status: "visible",
  deletedBy: null,
  editedAt: null,
  createdAt: at,
  likeCount: 0,
  likedByMe: false,
  ...extra,
});
const ids = (d: InfiniteData<ChatMessage[]> | undefined) => d?.pages.map((p) => p.map((m) => m.id));
// 2026-11-27T10:00:<ss>.000001+00:00, raw like PostgREST sends it (microseconds).
const at = (s: number) =>
  `2026-11-27T10:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(
    2,
    "0",
  )}.000001+00:00`;

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient();
  vi.mocked(service.fetchMessages).mockReset();
  vi.mocked(service.sendMessage).mockReset();
});
afterEach(() => {
  qc.clear();
  vi.useRealTimers();
});

it("every messaging query is disabled when the groups module is off", () => {
  expect(conversationsQueryOptions(off).enabled).toBe(false);
  expect(unreadMessagesQueryOptions(off).enabled).toBe(false);
  expect(accountLinkedQueryOptions(off).enabled).toBe(false);
  expect(messagesQueryOptions(off, "c1").enabled).toBe(false);
  expect(conversationsQueryOptions(on()).enabled).toBe(true);
  expect(messagesQueryOptions(on(), "c1").enabled).toBe(true);
  expect(messagesQueryOptions(on(), null).enabled).toBe(false);
});

it("pages backwards from the oldest loaded message, raw timestamp kept", () => {
  const o = messagesQueryOptions(on(), "c1");
  const full = Array.from({ length: MESSAGES_PAGE_SIZE }, (_, i) => msg(`m${i}`, at(100 - i)));
  const short = full.slice(0, 3);
  expect(o.getNextPageParam(full, [full])).toEqual({ createdAt: at(100 - 39), id: "m39" });
  expect(o.getNextPageParam(short, [short])).toBeUndefined(); // the whole conversation
  expect(o.getNextPageParam(short, [full, short])).toEqual({ createdAt: at(98), id: "m2" });
  expect(o.getNextPageParam([], [full, []])).toBeUndefined();
  const sending = [msg("optimistic-1", at(200))];
  expect(o.getNextPageParam(sending, [sending])).toBeUndefined();
});

it("useMessages drops a message that became unreadable", async () => {
  const cfg = on();
  qc.setQueryData(messagesKey("c1"), {
    pages: [[msg("m3", at(3)), msg("m2", at(2)), msg("m1", at(1))]],
    pageParams: [undefined],
  });
  // m2 was hidden by moderation: RLS drops it from the refetched newest page.
  vi.mocked(service.fetchMessages).mockResolvedValue([
    msg("m4", at(4)),
    msg("m3", at(3)),
    msg("m1", at(1)),
  ]);
  await refreshNewestMessages(cfg, qc, "c1");
  expect(service.fetchMessages).toHaveBeenCalledWith(cfg, "c1");
  expect(ids(qc.getQueryData(messagesKey("c1")))).toEqual([["m4", "m3", "m1"]]);
});

it("a refresh keeps the older pages below the newest one", async () => {
  const cfg = on();
  const page = (from: number) =>
    Array.from({ length: MESSAGES_PAGE_SIZE }, (_, i) => msg(`m${from - i}`, at(from - i)));
  qc.setQueryData(messagesKey("c1"), {
    pages: [page(100), page(60)],
    pageParams: [undefined, { createdAt: at(61), id: "m61" }],
  });
  vi.mocked(service.fetchMessages).mockResolvedValue(page(102)); // m102..m63
  await refreshNewestMessages(cfg, qc, "c1");
  const d = qc.getQueryData<InfiniteData<ChatMessage[]>>(messagesKey("c1"))!;
  const flat = d.pages.flat().map((m) => m.id);
  expect(flat[0]).toBe("m102");
  expect(flat.at(-1)).toBe("m21");
  expect(new Set(flat).size).toBe(flat.length); // nothing repeated
  expect(flat).toContain("m62"); // the old page holds what the fresh page no longer reaches
});

it("a refresh keeps a message still being sent on top", async () => {
  const cfg = on();
  qc.setQueryData(messagesKey("c1"), {
    pages: [[msg("optimistic-1", at(9)), msg("m1", at(1))]],
    pageParams: [undefined],
  });
  vi.mocked(service.fetchMessages).mockResolvedValue([msg("m2", at(2)), msg("m1", at(1))]);
  await refreshNewestMessages(cfg, qc, "c1");
  expect(ids(qc.getQueryData(messagesKey("c1")))).toEqual([["optimistic-1", "m2", "m1"]]);
});

it("useSendMessage shows the message at once and swaps in the real one", async () => {
  const onEvent = vi.fn();
  const cfg = on(onEvent);
  qc.setQueryData(["community", "myUid"], "me");
  qc.setQueryData(messagesKey("c1"), { pages: [[msg("m1", at(1))]], pageParams: [undefined] });
  let resolve!: (m: ChatMessage) => void;
  vi.mocked(service.sendMessage).mockReturnValue(new Promise((r) => (resolve = r)));
  const observer = new MutationObserver(qc, sendMessageMutationOptions(cfg, qc));
  const done = observer.mutate({ conversationId: "c1", body: "hi", replyToId: "m1" });
  await vi.waitFor(() => expect(service.sendMessage).toHaveBeenCalled());
  const pending = qc.getQueryData<InfiniteData<ChatMessage[]>>(messagesKey("c1"))!.pages[0]!;
  expect(pending[0]!.id).toMatch(/^optimistic-/);
  expect(pending[0]!.authorId).toBe("me");
  expect(pending[0]!.replyTo).toEqual({
    id: "m1",
    authorId: "u2",
    body: "body m1",
    deleted: false,
  });
  resolve(msg("real", at(5), { authorId: "me", body: "hi" }));
  await done;
  expect(ids(qc.getQueryData(messagesKey("c1")))).toEqual([["real", "m1"]]);
  expect(onEvent).toHaveBeenCalledWith("community_message_sent", {
    conversationId: "c1",
    messageId: "real",
    kind: "group",
    hasImage: false,
    hasAttachment: false,
    isReply: true,
  });
});

it("useSendMessage restores the draft on rate_limited", async () => {
  const onEvent = vi.fn();
  const cfg = on(onEvent);
  qc.setQueryData(messagesKey("c1"), { pages: [[msg("m1", at(1))]], pageParams: [undefined] });
  vi.mocked(service.sendMessage).mockRejectedValue(new MessagingError("rate_limited"));
  const onError = vi.fn();
  const draft = { conversationId: "c1", body: "hello there", imageUri: "file:///a.jpg" };
  const observer = new MutationObserver(qc, sendMessageMutationOptions(cfg, qc));
  const stop = observer.subscribe(() => {}); // per-call callbacks need a listener, as in useMutation
  await observer.mutate(draft, { onError }).catch(() => {});
  stop();
  expect(ids(qc.getQueryData(messagesKey("c1")))).toEqual([["m1"]]);
  const [error, , context] = onError.mock.calls[0]!;
  expect((error as MessagingError).code).toBe("rate_limited");
  expect((context as { draft: unknown }).draft).toEqual(draft);
  expect(onEvent).not.toHaveBeenCalled();
});

it("useTyping expires an id 5 s after its last event", () => {
  vi.useFakeTimers();
  const seen: string[][] = [];
  const t = createTypingTracker((ids) => seen.push(ids));
  t.add("u2");
  t.add("u3");
  vi.advanceTimersByTime(4000);
  t.add("u2"); // typing again: its 5 s restart
  vi.advanceTimersByTime(1000);
  expect(seen.at(-1)).toEqual(["u2"]);
  vi.advanceTimersByTime(4000);
  expect(seen.at(-1)).toEqual([]);
  t.stop();
});

it("useMessagingBadge per messaging.badge", () => {
  const conv = (unread: number, notify: boolean): Conversation => ({
    id: "x",
    kind: "group",
    lastMessageAt: null,
    lastMessage: null,
    unread,
    notify,
    role: "member",
  });
  const list = [conv(2, false), conv(3, true)];
  expect(messagingBadge("followed", 3, list)).toEqual({ count: 3, dot: false });
  expect(messagingBadge("all", 3, list)).toEqual({ count: 5, dot: false });
  expect(messagingBadge("dot", 3, list)).toEqual({ count: 0, dot: true });
  expect(messagingBadge("dot", 0, list)).toEqual({ count: 0, dot: false }); // muted never lights it
  expect(messagingBadge("all", undefined, undefined)).toEqual({ count: 0, dot: false });
  // Pending DM requests count in "all" (the backend's followed count has them already).
  expect(messagingBadge("all", 3, list, 2)).toEqual({ count: 7, dot: false });
});

it("dms alone turn the messaging queries on, not the groups ones", () => {
  const dms = resolveConfig({ ...base, modules: { ...mods, dms: {} } });
  expect(conversationsQueryOptions(dms).enabled).toBe(true);
  expect(messagesQueryOptions(dms, "c1").enabled).toBe(true);
  expect(dmRequestsQueryOptions(dms).enabled).toBe(true);
  expect(groupsEnabled(dms)).toBe(false);
  expect(dmRequestsQueryOptions(on()).enabled).toBe(false);
});

it("usePeerRead stays off (null) unless read receipts are on", () => {
  const dms = (readReceipts: boolean) =>
    resolveConfig({ ...base, modules: { ...mods, dms: { readReceipts } } });
  expect(peerReadQueryOptions(dms(false), "c1").enabled).toBe(false);
  expect(peerReadQueryOptions(dms(true), "c1").enabled).toBe(true);
  expect(peerReadQueryOptions(dms(true), null).enabled).toBe(false);
  expect(peerReadQueryOptions(off, "c1").enabled).toBe(false);
});

it("conversations and the badge poll cheaply and key under community", () => {
  const o = conversationsQueryOptions(on());
  expect(o.queryKey).toEqual(CONVERSATIONS_KEY);
  expect(o.refetchIntervalInBackground).toBe(false);
});

const fullPage = (from: number) =>
  Array.from({ length: MESSAGES_PAGE_SIZE }, (_, i) => msg(`m${from - i}`, at(from - i)));

it("a refresh that doesn't reach the cache restarts the history (no hole)", async () => {
  const cfg = on();
  qc.setQueryData(messagesKey("c1"), {
    pages: [fullPage(100), fullPage(60)],
    pageParams: [undefined, { createdAt: at(61), id: "m61" }],
  });
  // 60 messages arrived during a long disconnect: the fresh page is m160..m121.
  vi.mocked(service.fetchMessages).mockResolvedValue(fullPage(160));
  await refreshNewestMessages(cfg, qc, "c1");
  const d = qc.getQueryData<MessagesData>(messagesKey("c1"))!;
  expect(d.pages).toHaveLength(1);
  expect(d.pages[0]![0]!.id).toBe("m160");
  expect(d.pageParams).toEqual([undefined]);
  // Scrolling up loads from m121 on, the messages between are not skipped.
  expect(messagesQueryOptions(cfg, "c1").getNextPageParam(d.pages[0]!, d.pages)).toEqual({
    createdAt: at(121),
    id: "m121",
  });
});

it("a refresh while a page is loading waits for it instead of racing it", async () => {
  vi.useFakeTimers();
  const cfg = on();
  let loaded!: (m: ChatMessage[]) => void;
  vi.mocked(service.fetchMessages)
    .mockResolvedValueOnce(fullPage(100))
    .mockImplementationOnce(() => new Promise((r) => (loaded = r)))
    .mockResolvedValue(fullPage(101));
  const observer = new InfiniteQueryObserver(qc, messagesQueryOptions(cfg, "c1"));
  const stop = observer.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  void observer.fetchNextPage();
  await vi.advanceTimersByTimeAsync(0);
  await refreshNewestMessages(cfg, qc, "c1");
  expect(service.fetchMessages).toHaveBeenCalledTimes(2); // not refreshed yet
  loaded(fullPage(60));
  await vi.advanceTimersByTimeAsync(200);
  expect(service.fetchMessages).toHaveBeenCalledTimes(3);
  const flat = qc.getQueryData<MessagesData>(messagesKey("c1"))!.pages.flat();
  expect(flat[0]!.id).toBe("m101");
  expect(flat[flat.length - 1]!.id).toBe("m21"); // the loaded page survived the refresh
  stop();
});

it("sending before the first page loads doesn't cancel that load", async () => {
  const cfg = on();
  let loaded!: (m: ChatMessage[]) => void;
  vi.mocked(service.fetchMessages).mockImplementationOnce(() => new Promise((r) => (loaded = r)));
  vi.mocked(service.sendMessage).mockResolvedValue(msg("real", at(5)));
  const observer = new InfiniteQueryObserver(qc, messagesQueryOptions(cfg, "c1"));
  const stop = observer.subscribe(() => {});
  await new MutationObserver(qc, sendMessageMutationOptions(cfg, qc)).mutate({
    conversationId: "c1",
    body: "hi",
  });
  loaded([msg("real", at(5)), msg("m1", at(1))]);
  await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
  expect(ids(observer.getCurrentResult().data)).toEqual([["real", "m1"]]);
  stop();
});

it("optimistic ids are unique within the same millisecond", async () => {
  const cfg = on();
  qc.setQueryData(messagesKey("c1"), { pages: [[]], pageParams: [undefined] });
  vi.mocked(service.sendMessage).mockReturnValue(new Promise(() => {}));
  vi.spyOn(Date, "now").mockReturnValue(1);
  const opts = sendMessageMutationOptions(cfg, qc);
  void new MutationObserver(qc, opts).mutate({ conversationId: "c1", body: "a" });
  void new MutationObserver(qc, opts).mutate({ conversationId: "c1", body: "b" });
  await vi.waitFor(() => expect(service.sendMessage).toHaveBeenCalledTimes(2));
  const page = qc.getQueryData<MessagesData>(messagesKey("c1"))!.pages[0]!;
  expect(new Set(page.map((m) => m.id)).size).toBe(2);
  vi.mocked(Date.now).mockRestore();
});

it("afterDelete leaves what delete_message leaves, per role", () => {
  const mine = msg("m1", at(1), { authorId: "me" });
  const theirs = msg("m2", at(2), { authorId: "u2" });
  expect(afterDelete(mine, "me", false)).toMatchObject({
    status: "deleted",
    deletedBy: "author",
    body: null,
  });
  // An app admin deleting their own message is the author.
  expect(afterDelete(mine, "me", true)).toMatchObject({ status: "deleted", deletedBy: "author" });
  // A group creator on another's: the creator's placeholder.
  expect(afterDelete(theirs, "me", false)).toMatchObject({
    status: "deleted",
    deletedBy: "creator",
  });
  // An app admin on another's: hidden, gone from the list.
  expect(afterDelete(theirs, "me", true)).toBeNull();
});

it("invalidateGroup marks the group, its members, my conversations and the search stale, nothing else", async () => {
  const keys = [
    groupKey("g1", "fr"),
    groupKey("g1"),
    [...groupMembersKey("g1"), ""],
    CONVERSATIONS_KEY,
    [...GROUPS_SEARCH_KEY, "runners"],
    groupKey("g2"),
    messagesKey("g1"),
  ];
  for (const k of keys) qc.setQueryData(k, { v: 1 });
  await invalidateGroup(qc, "g1");
  const stale = keys.map((k) => qc.getQueryState(k)!.isInvalidated);
  expect(stale).toEqual([true, true, true, true, true, false, false]);
});

const dmsCfg = (onEvent = vi.fn(), messaging = {}) =>
  resolveConfig({ ...base, modules: { ...mods, dms: {} }, messaging, host: { onEvent } });

it("useStartDm emits community_dm_started with the conversation and the source", async () => {
  const onEvent = vi.fn();
  const cfg = dmsCfg(onEvent);
  const result = await new MutationObserver(qc, startDmMutationOptions(cfg, qc)).mutate({
    recipientId: "u2",
    source: "newMessage",
  });
  expect(result).toBe("c9");
  expect(dms.startDm).toHaveBeenCalledWith(cfg, "u2");
  expect(onEvent).toHaveBeenCalledWith("community_dm_started", {
    conversationId: "c9",
    source: "newMessage",
  });
});

it("declining or blocking a request drops its messages from the cache", async () => {
  const onEvent = vi.fn();
  const cfg = dmsCfg(onEvent);
  for (const [action, event] of [
    ["decline", "community_dm_request_declined"],
    ["block", "community_dm_request_blocked"],
  ] as const) {
    qc.setQueryData(messagesKey("c1"), { pages: [[msg("m1", at(1))]], pageParams: [undefined] });
    await new MutationObserver(qc, requestAnswerMutationOptions(cfg, qc, action)).mutate({
      conversationId: "c1",
      reason: "spam",
    });
    expect(qc.getQueryData(messagesKey("c1"))).toBeUndefined();
    expect(onEvent).toHaveBeenLastCalledWith(event, { conversationId: "c1" });
  }
  expect(dms.blockAndReportRequest).toHaveBeenCalledWith(cfg, "c1", "spam");
});

it("the badge reads DM requests only with dms and badge all", () => {
  expect(messagingBadgeQueries(dmsCfg(undefined, { badge: "all" })).requests.enabled).toBe(true);
  expect(messagingBadgeQueries(dmsCfg()).requests.enabled).toBe(false); // followed: server counts them
  expect(
    messagingBadgeQueries(
      resolveConfig({ ...base, modules: { ...mods, groups: {} }, messaging: { badge: "all" } }),
    ).requests.enabled,
  ).toBe(false);
  expect(messagingBadgeQueries(dmsCfg()).requests.queryKey).toEqual(DM_REQUESTS_KEY);
});

it("useDmFlags batches the ids asked at once into one profile_dm_flags call", async () => {
  vi.useFakeTimers();
  const cfg = dmsCfg();
  vi.mocked(dms.fetchDmFlags).mockClear();
  const answers = Promise.all(
    ["u2", "u3", "u4"].map((id) => dmFlagQueryOptions(cfg, id).queryFn()),
  );
  await vi.advanceTimersByTimeAsync(30);
  expect(await answers).toEqual([true, false, true]);
  expect(dms.fetchDmFlags).toHaveBeenCalledTimes(1);
  expect(dms.fetchDmFlags).toHaveBeenCalledWith(cfg, ["u2", "u3", "u4"]);
  expect(dmFlagQueryOptions(off, "u2").enabled).toBe(false);
});

it("a DM change on my own channel refetches my requests, conversations and badge only", () => {
  const cfg = dmsCfg();
  const keys = [DM_REQUESTS_KEY, CONVERSATIONS_KEY, UNREAD_MESSAGES_KEY, messagesKey("c1")];
  for (const k of keys) qc.setQueryData(k, { v: 1 });
  const stop = watchDms(cfg, qc);
  const [subCfg, onChange] = vi.mocked(realtime.subscribeDms).mock.calls.at(-1)!;
  expect(subCfg).toBe(cfg);
  onChange();
  expect(keys.map((k) => qc.getQueryState(k)!.isInvalidated)).toEqual([true, true, true, false]);
  stop();
  vi.mocked(realtime.subscribeDms).mockClear();
  watchDms(on(), qc)(); // groups only: no DM channel
  expect(realtime.subscribeDms).not.toHaveBeenCalled();
});
