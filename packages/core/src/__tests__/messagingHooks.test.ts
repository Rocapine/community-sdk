import { MutationObserver, QueryClient, type InfiniteData } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { CONVERSATIONS_KEY, messagesKey } from "../keys";
import {
  accountLinkedQueryOptions,
  conversationsQueryOptions,
  createTypingTracker,
  messagesQueryOptions,
  messagingBadge,
  refreshNewestMessages,
  sendMessageMutationOptions,
  unreadMessagesQueryOptions,
} from "../messaging-hooks";
import * as service from "../messaging-service";
import { MessagingError, MESSAGES_PAGE_SIZE } from "../messaging-service";
import type { ChatMessage, Conversation } from "../models";

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
});

it("conversations and the badge poll cheaply and key under community", () => {
  const o = conversationsQueryOptions(on());
  expect(o.queryKey).toEqual(CONVERSATIONS_KEY);
  expect(o.refetchIntervalInBackground).toBe(false);
});
