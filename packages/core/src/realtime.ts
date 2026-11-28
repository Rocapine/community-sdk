// Realtime per conversation (groups and dms modules): one private channel `conversation:<id>`
// carrying database changes of its messages (RLS applied; a like is an UPDATE of
// like_count), the typing broadcast and the `members` broadcast (groups/004), authorised by the realtime.messages policies of
// messaging/001_messaging.sql. Every subscriber of a conversation shares the channel.
// DMs (dms/005): one more private channel per member, `dms:<my id>`, on which the
// server says a DM of mine changed (a new DM or request for me, my request accepted, a
// block added or removed). A DM's join the server refuses (a blocked DM) waits for that
// event, or the screen opening again, instead of retrying every few seconds; a refused
// group join retries with a growing delay (a readmitted member reconnects by itself).

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

import {
  dmsSettings,
  groupsSettings,
  messagingSettings,
  type ResolvedCommunityConfig,
} from "./config";
import { requireUid } from "./service";

export const CHANGE_DEBOUNCE_MS = 150;
export const TYPING_THROTTLE_MS = 3000;
// realtime-js hands back a channel still closing when its topic is reopened, so the last
// unsubscribe waits a moment: a StrictMode remount or a quick re-open reuses the channel.
const RELEASE_DELAY_MS = 1000;
/** A refused group join asks again after 12 s, then twice as long each time, up to 5 min. */
export const REFUSED_RETRY_MS = 12_000;
export const REFUSED_RETRY_MAX_MS = 300_000;

export type ConversationHandlers = {
  onChange(): void;
  onTyping(userId: string): void;
  /** groups/004: someone joined, left or was removed (the member count changed). */
  onMembers?(): void;
  /** dms/003: a DM member moved their read mark (read receipts on; server-sent only). */
  onRead?(): void;
};

type Entry = {
  /** Null until opened (after auth, and after a previous channel of the topic closed),
   * and while refused. */
  channel: RealtimeChannel | null;
  listeners: Set<ConversationHandlers>;
  uid: string | null;
  joined: boolean;
  /** The server refused the join (not allowed to read the topic, e.g. a blocked DM):
   * no retry until `retryRefused`, a new listener or, outside DMs, the backoff timer. */
  refused: boolean;
  /** A DM (or my own DM channel): a refusal waits for `retryRefused` (no timer). */
  dm: boolean;
  /** Refusals in a row, for the backoff. */
  refusals: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  /** Opens the channel (again). */
  connect(): void;
  lastTypingAt: number;
  changeTimer?: ReturnType<typeof setTimeout>;
  releaseTimer?: ReturnType<typeof setTimeout>;
};

/** Keyed by conversation id, or `dms:<uid>` for my own channel. */
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

/** Removes `entry`'s channel; reopening the key waits until it's gone. */
function close(client: SupabaseClient, key: string, entry: Entry) {
  const reg = registry(client);
  entry.joined = false;
  if (!entry.channel) return; // never opened
  const closing = client
    .removeChannel(entry.channel)
    .catch(() => {})
    .finally(() => {
      if (reg.closing.get(key) === closing) reg.closing.delete(key);
    });
  entry.channel = null;
  reg.closing.set(key, closing);
}

/** A join the server refused because the caller may not read the topic (Realtime's
 * "Unauthorized: You do not have permissions to read from this Channel topic"). */
const isRefused = (err: Error | undefined) => /unauthori[sz]ed/i.test(err?.message ?? "");

/** dms/006 sends `changed` on both members' own channels when a block is added or
 * removed: a refused conversation channel may be readable again, so each rejoins once
 * (a refusal again waits for the next one). */
function retryRefused(client: SupabaseClient) {
  for (const entry of registry(client).open.values()) if (entry.refused) retry(entry);
}

function retry(entry: Entry) {
  entry.refused = false;
  entry.connect();
}

/** Opens the channel `topic(uid)` (none when it returns null) once authorised, with the
 * events `bind` listens to; every (re)join calls onChange. A join refused for
 * authorisation is closed instead of retried (realtime-js would retry it every few
 * seconds for as long as the screen is open). */
function open(
  cfg: ResolvedCommunityConfig,
  client: SupabaseClient,
  key: string,
  topic: (uid: string | null) => string | null,
  bind: (channel: RealtimeChannel, entry: Entry) => RealtimeChannel,
  dm: boolean,
) {
  const entry: Entry = {
    channel: null,
    listeners: new Set(),
    uid: null,
    joined: false,
    refused: false,
    dm,
    refusals: 0,
    lastTypingAt: 0,
    connect: () => void connect(),
  };
  const reg = registry(client);
  const connect = async () => {
    clearTimeout(entry.retryTimer);
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
    await reg.closing.get(key);
    if (reg.open.get(key) !== entry) return; // released meanwhile
    const name = topic(entry.uid);
    if (!name) return;
    const channel = client.channel(name, { config: { private: true } });
    entry.channel = channel;
    bind(channel, entry).subscribe((status, err) => {
      if (entry.channel !== channel) return; // closed meanwhile
      entry.joined = status === "SUBSCRIBED";
      // Every (re)join refetches: what changed before the join, or while the socket was
      // down (a sleeping web tab, a lost network), never arrives as an event.
      if (entry.joined) {
        entry.refusals = 0;
        changed(entry);
      }
      if (status === "CHANNEL_ERROR" && isRefused(err)) {
        entry.refused = true;
        close(client, key, entry);
        if (entry.dm) return;
        const delay = Math.min(REFUSED_RETRY_MS * 2 ** entry.refusals, REFUSED_RETRY_MAX_MS);
        entry.refusals++;
        entry.retryTimer = setTimeout(() => {
          if (entry.refused && reg.open.get(key) === entry) retry(entry);
        }, delay);
      }
    });
  };
  entry.connect();
  return entry;
}

function bindConversation(conversationId: string) {
  return (channel: RealtimeChannel, entry: Entry) =>
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
      .on("broadcast", { event: "members" }, () => {
        for (const l of entry.listeners) l.onMembers?.();
      })
      .on("broadcast", { event: "read" }, () => {
        for (const l of entry.listeners) l.onRead?.();
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const userId = (payload as { userId?: unknown } | undefined)?.userId;
        if (typeof userId === "string") for (const l of entry.listeners) l.onTyping(userId);
      });
}

/** A listener on the registry entry `key` (opened by `create` when it has none), with
 * the shared release: the last unsubscribe closes the channel a moment later. */
function listen(
  client: SupabaseClient,
  key: string,
  create: () => Entry,
  handlers: ConversationHandlers,
  dm = false,
): () => void {
  const reg = registry(client);
  let entry = reg.open.get(key);
  if (!entry) reg.open.set(key, (entry = create()));
  else if (entry.refused) retry(entry); // a screen opened again: ask once more
  if (dm) entry.dm = true; // learnt late (the screen confirmed a DM)
  clearTimeout(entry.releaseTimer);
  const own = entry;
  own.listeners.add(handlers);
  return () => {
    own.listeners.delete(handlers);
    if (own.listeners.size > 0) return;
    clearTimeout(own.releaseTimer);
    own.releaseTimer = setTimeout(() => {
      if (own.listeners.size > 0 || reg.open.get(key) !== own) return;
      reg.open.delete(key);
      clearTimeout(own.changeTimer);
      clearTimeout(own.retryTimer);
      close(client, key, own);
    }, RELEASE_DELAY_MS);
  };
}

/** Listens to a conversation's changes and typing while subscribed. `onChange` is
 * debounced and also fires on every (re)join. `dm`: the conversation is a DM (without
 * groups, every conversation is): a refused join then waits for a DM change instead of
 * the backoff. Returns the unsubscribe. */
export function subscribeConversation(
  cfg: ResolvedCommunityConfig,
  conversationId: string,
  handlers: ConversationHandlers,
  { dm = false }: { dm?: boolean } = {},
): () => void {
  if (!messagingSettings(cfg) || !cfg.supabase) return () => {};
  const client = cfg.supabase;
  const isDm = dm || !groupsSettings(cfg);
  return listen(
    client,
    conversationId,
    () =>
      open(
        cfg,
        client,
        conversationId,
        () => `conversation:${conversationId}`,
        bindConversation(conversationId),
        isDm,
      ),
    handlers,
    isDm,
  );
}

/** dms/005: calls `onChange` (debounced, and on every (re)join) when the server says a
 * DM of `uid` (the signed-in member) changed: a new DM or request for me, or my request
 * accepted. One channel, `dms:<uid>`, shared by every subscriber; a sign-in as someone
 * else subscribes again with the new id (never opened when the session has already
 * moved on). Returns the unsubscribe. */
export function subscribeDms(
  cfg: ResolvedCommunityConfig,
  uid: string,
  onChange: () => void,
): () => void {
  if (!dmsSettings(cfg) || !cfg.supabase) return () => {};
  const client = cfg.supabase;
  const key = `dms:${uid}`;
  return listen(
    client,
    key,
    () =>
      open(
        cfg,
        client,
        key,
        (sessionUid) => (sessionUid === uid ? key : null),
        (channel, entry) =>
          channel.on("broadcast", { event: "changed" }, () => {
            changed(entry);
            retryRefused(client);
          }),
        true,
      ),
    { onChange, onTyping: () => {} },
  );
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
