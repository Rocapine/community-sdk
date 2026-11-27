// Realtime per conversation (groups module): one private channel `conversation:<id>`
// carrying database changes of its messages (RLS applied; a like is an UPDATE of
// like_count) and the typing broadcast, authorised by the realtime.messages policies of
// messaging/001_messaging.sql. Every subscriber of a conversation shares the channel.

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

import { groupsSettings, type ResolvedCommunityConfig } from "./config";
import { requireUid } from "./service";

export const CHANGE_DEBOUNCE_MS = 150;
export const TYPING_THROTTLE_MS = 3000;
// realtime-js hands back a channel still closing when its topic is reopened, so the last
// unsubscribe waits a moment: a StrictMode remount or a quick re-open reuses the channel.
const RELEASE_DELAY_MS = 1000;

export type ConversationHandlers = { onChange(): void; onTyping(userId: string): void };

type Entry = {
  /** Null until opened (after auth, and after a previous channel of the topic closed). */
  channel: RealtimeChannel | null;
  listeners: Set<ConversationHandlers>;
  uid: string | null;
  joined: boolean;
  lastTypingAt: number;
  changeTimer?: ReturnType<typeof setTimeout>;
  releaseTimer?: ReturnType<typeof setTimeout>;
};

type Registry = { open: Map<string, Entry>; closing: Map<string, Promise<unknown>> };
const registries = new WeakMap<SupabaseClient, Registry>();

function registry(client: SupabaseClient) {
  let r = registries.get(client);
  if (!r) registries.set(client, (r = { open: new Map(), closing: new Map() }));
  return r;
}

function changed(entry: Entry) {
  clearTimeout(entry.changeTimer);
  entry.changeTimer = setTimeout(() => {
    for (const l of entry.listeners) l.onChange();
  }, CHANGE_DEBOUNCE_MS);
}

function open(cfg: ResolvedCommunityConfig, client: SupabaseClient, conversationId: string) {
  const entry: Entry = {
    channel: null,
    listeners: new Set(),
    uid: null,
    joined: false,
    lastTypingAt: 0,
  };
  const reg = registry(client);
  void (async () => {
    try {
      entry.uid = await requireUid(cfg);
      // A private channel joins with the session's JWT: set it first, a restored
      // session may not have reached Realtime yet.
      const { data } = await client.auth.getSession();
      if (data.session) await client.realtime.setAuth(data.session.access_token);
    } catch (e) {
      console.warn("[community] realtime auth failed", e);
    }
    // client.channel(topic) hands back a channel of that topic still closing: wait for it.
    await reg.closing.get(conversationId);
    if (reg.open.get(conversationId) !== entry) return; // released meanwhile
    const channel = client.channel(`conversation:${conversationId}`, {
      config: { private: true },
    });
    entry.channel = channel;
    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => changed(entry),
      )
      // messaging/004: a message hidden by moderation, which RLS keeps out of postgres_changes.
      .on("broadcast", { event: "changed" }, () => changed(entry))
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const userId = (payload as { userId?: unknown } | undefined)?.userId;
        if (typeof userId === "string") for (const l of entry.listeners) l.onTyping(userId);
      })
      .subscribe((status) => {
        entry.joined = status === "SUBSCRIBED";
        // Every (re)join refetches: what changed before the join, or while the socket was
        // down (a sleeping web tab, a lost network), never arrives as an event.
        if (entry.joined) changed(entry);
      });
  })();
  return entry;
}

/** Listens to a conversation's changes and typing while subscribed. `onChange` is
 * debounced and also fires on every (re)join. Returns the unsubscribe. */
export function subscribeConversation(
  cfg: ResolvedCommunityConfig,
  conversationId: string,
  handlers: ConversationHandlers,
): () => void {
  if (!groupsSettings(cfg) || !cfg.supabase) return () => {};
  const client = cfg.supabase;
  const reg = registry(client);
  let entry = reg.open.get(conversationId);
  if (!entry) reg.open.set(conversationId, (entry = open(cfg, client, conversationId)));
  clearTimeout(entry.releaseTimer);
  const own = entry;
  own.listeners.add(handlers);
  return () => {
    own.listeners.delete(handlers);
    if (own.listeners.size > 0) return;
    clearTimeout(own.releaseTimer);
    own.releaseTimer = setTimeout(() => {
      if (own.listeners.size > 0 || reg.open.get(conversationId) !== own) return;
      reg.open.delete(conversationId);
      clearTimeout(own.changeTimer);
      own.joined = false;
      if (!own.channel) return; // never opened
      const closing = client
        .removeChannel(own.channel)
        .catch(() => {})
        .finally(() => {
          if (reg.closing.get(conversationId) === closing) reg.closing.delete(conversationId);
        });
      reg.closing.set(conversationId, closing);
    }, RELEASE_DELAY_MS);
  };
}

/** Tells the conversation's other readers that I'm typing: at most once per 3 s, and
 * only on a joined channel (members only: the backend refuses anyone else's). */
export function sendTyping(cfg: ResolvedCommunityConfig, conversationId: string): void {
  if (!cfg.supabase) return;
  const entry = registry(cfg.supabase).open.get(conversationId);
  if (!entry?.channel || !entry.joined || !entry.uid) return;
  const now = Date.now();
  if (now - entry.lastTypingAt < TYPING_THROTTLE_MS) return;
  entry.lastTypingAt = now;
  void entry.channel.send({ type: "broadcast", event: "typing", payload: { userId: entry.uid } });
}
