// React Query hooks over the messaging and groups services (groups module). Every query
// and subscription is off unless the groups module is on and a backend is configured:
// the services throw when it is off.

import {
  focusManager,
  hashKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { groupsSettings, messagingSettings, type ResolvedCommunityConfig } from "./config";
import { COMMUNITY_EVENTS, emitEvent } from "./events";
import {
  GROUP_MEMBERS_PAGE_SIZE,
  GROUPS_PAGE_SIZE,
  createGroup,
  editGroup,
  fetchGroup,
  fetchGroupMembers,
  fetchGroupOnlineCounts,
  joinGroup,
  leaveGroup,
  readmitMember,
  removeMember,
  searchGroups,
  setGroupNotify,
} from "./groups-service";
import { isOptimistic, ownAuthorFields } from "./hooks";
import {
  CONVERSATIONS_KEY,
  GROUPS_KEY,
  GROUPS_SEARCH_KEY,
  UNREAD_MESSAGES_KEY,
  groupKey,
  groupMembersKey,
  messagesKey,
} from "./keys";
import { readerLocale } from "./locale";
import {
  MESSAGES_PAGE_SIZE,
  deleteMessage,
  editMessage,
  fetchAccountLinked,
  fetchConversations,
  fetchMessages,
  markConversationRead,
  sendMessage,
  setMessageLike,
  translateMessage,
  unreadFollowedMessages,
  type SendMessageInput,
} from "./messaging-service";
import type { ChatMessage, Conversation, Group } from "./models";
import { PRESENCE_POLL_MS } from "./presence-hooks";
import { useCommunityConfig } from "./provider";
import { CHANGE_DEBOUNCE_MS, sendTyping, subscribeConversation } from "./realtime";

export const TYPING_TTL_MS = 5000;
// Like the inbox: the badge stays honest while the app is open, even without push.
const BADGE_POLL_MS = 120_000;
const ACCOUNT_LINKED_KEY = ["community", "accountLinked"] as const;

type MessageCursor = { createdAt: string; id: string };
export type MessagesData = InfiniteData<ChatMessage[], MessageCursor | undefined>;

const messagingEnabled = (cfg: ResolvedCommunityConfig) =>
  groupsSettings(cfg) !== null && cfg.supabase !== null;

// ============ CONVERSATIONS & BADGE ============

export function conversationsQueryOptions(cfg: ResolvedCommunityConfig) {
  return {
    queryKey: CONVERSATIONS_KEY,
    queryFn: () => fetchConversations(cfg),
    enabled: messagingEnabled(cfg),
    staleTime: 30_000,
    refetchInterval: BADGE_POLL_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  };
}

export function unreadMessagesQueryOptions(cfg: ResolvedCommunityConfig) {
  return {
    ...conversationsQueryOptions(cfg),
    queryKey: UNREAD_MESSAGES_KEY,
    queryFn: () => unreadFollowedMessages(cfg),
  };
}

export function accountLinkedQueryOptions(cfg: ResolvedCommunityConfig) {
  return {
    queryKey: ACCOUNT_LINKED_KEY,
    queryFn: () => fetchAccountLinked(cfg),
    enabled: messagingEnabled(cfg),
    staleTime: 60_000,
    retry: 1,
  };
}

/** My active conversations, latest activity first. */
export function useConversations() {
  return useQuery(conversationsQueryOptions(useCommunityConfig()));
}

/** False only when the accounts module is installed and I have no linked account;
 * null until known. */
export function useAccountLinked(): boolean | null {
  const opts = accountLinkedQueryOptions(useCommunityConfig());
  const data = useQuery(opts).data;
  return opts.enabled && data !== undefined ? data : null;
}

/** The header badge per `messaging.badge`. A muted group (notify off) never lights
 * `followed` or `dot`. */
export function messagingBadge(
  badge: "followed" | "all" | "dot",
  followedUnread: number | undefined,
  conversations: Conversation[] | undefined,
): { count: number; dot: boolean } {
  if (badge === "all")
    return { count: (conversations ?? []).reduce((n, c) => n + c.unread, 0), dot: false };
  if (badge === "dot") return { count: 0, dot: (followedUnread ?? 0) > 0 };
  return { count: followedUnread ?? 0, dot: false };
}

export function useMessagingBadge(): { count: number; dot: boolean } {
  const cfg = useCommunityConfig();
  const badge = messagingSettings(cfg)?.badge ?? "followed";
  const followed = unreadMessagesQueryOptions(cfg);
  const all = conversationsQueryOptions(cfg);
  const f = useQuery({ ...followed, enabled: followed.enabled && badge !== "all" }).data;
  const c = useQuery({ ...all, enabled: all.enabled && badge === "all" }).data;
  // A disabled query keeps its cached data: answer the module-off case here.
  return all.enabled ? messagingBadge(badge, f, c) : { count: 0, dot: false };
}

// ============ MESSAGES ============

const cursorOf = (page: ChatMessage[]): MessageCursor | undefined => {
  const last = [...page].reverse().find((m) => !isOptimistic(m));
  // The raw createdAt string: a Date round trip would drop its microseconds.
  return last ? { createdAt: last.createdAt, id: last.id } : undefined;
};

export function messagesQueryOptions(cfg: ResolvedCommunityConfig, conversationId: string | null) {
  return {
    queryKey: messagesKey(conversationId ?? "none"),
    queryFn: ({ pageParam }: { pageParam: MessageCursor | undefined }) =>
      fetchMessages(cfg, conversationId!, pageParam ? { before: pageParam } : {}),
    initialPageParam: undefined as MessageCursor | undefined,
    // A short first page is the whole conversation. Later pages may have lost rows to a
    // refresh (see mergeNewest), so only an empty one ends the history.
    getNextPageParam: (lastPage: ChatMessage[], allPages: ChatMessage[][]) =>
      (allPages.length === 1 ? lastPage.length >= MESSAGES_PAGE_SIZE : lastPage.length > 0)
        ? cursorOf(lastPage)
        : undefined,
    enabled: messagingEnabled(cfg) && !!conversationId,
    staleTime: 30_000,
    retry: 1,
  };
}

/** a before b in the conversation's order (created_at, id). */
const older = (a: ChatMessage, b: ChatMessage) =>
  a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);

/** Replaces the newest page with `fresh` (the conversation's newest page as the server
 * reads it now): rows it no longer returns (hidden, deleted by an admin) disappear,
 * changed ones update. Older pages keep only what is older than `fresh`, and only when
 * `fresh` reaches the cache: after a long disconnect a full page of newer messages would
 * leave a hole, so the history restarts from `fresh`. A message being sent stays on top. */
export function mergeNewest(data: MessagesData, fresh: ChatMessage[]): MessagesData {
  const sending = (data.pages[0] ?? []).filter(isOptimistic);
  const oldest = fresh[fresh.length - 1];
  const complete = fresh.length < MESSAGES_PAGE_SIZE;
  const cachedNewest = (data.pages[0] ?? []).find((m) => !isOptimistic(m));
  const overlaps = !!oldest && !!cachedNewest && !older(cachedNewest, oldest);
  const pages = [[...sending, ...fresh]];
  const pageParams: (MessageCursor | undefined)[] = [undefined];
  if (!complete && oldest && overlaps)
    data.pages.forEach((page, i) => {
      const rest = page.filter((m) => !isOptimistic(m) && older(m, oldest));
      if (rest.length > 0) {
        pages.push(rest);
        pageParams.push(data.pageParams[i]);
      }
    });
  return { pages, pageParams };
}

/** Refetches a loaded conversation's newest page and merges it in. Fail-soft: the next
 * change, rejoin or focus tries again. */
export async function refreshNewestMessages(
  cfg: ResolvedCommunityConfig,
  queryClient: QueryClient,
  conversationId: string,
): Promise<void> {
  const key = messagesKey(conversationId);
  if (!queryClient.getQueryData(key)) return; // the first load is still to come
  // A page load in flight would overwrite the merge with the pages it started from: wait.
  if (queryClient.isFetching({ queryKey: key }) > 0) {
    setTimeout(
      () => void refreshNewestMessages(cfg, queryClient, conversationId),
      CHANGE_DEBOUNCE_MS,
    );
    return;
  }
  let fresh: ChatMessage[];
  try {
    fresh = await fetchMessages(cfg, conversationId);
  } catch {
    return;
  }
  queryClient.setQueryData<MessagesData>(key, (d) => (d ? mergeNewest(d, fresh) : d));
}

/** A conversation's messages, newest page first (`pages[0][0]` is the newest message),
 * live while mounted: a Realtime change refetches the newest page, and the badge. */
export function useMessages(conversationId: string | null) {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  const opts = messagesQueryOptions(cfg, conversationId);
  const query = useInfiniteQuery(opts);
  const live = opts.enabled;
  useEffect(() => {
    if (!live || !conversationId) return;
    return subscribeConversation(cfg, conversationId, {
      onChange: () => {
        void refreshNewestMessages(cfg, queryClient, conversationId);
        void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
        void queryClient.invalidateQueries({ queryKey: UNREAD_MESSAGES_KEY });
      },
      onTyping: () => {},
    });
  }, [cfg, queryClient, conversationId, live]);
  return query;
}

/** Applies `fn` to every cached message of a conversation (null drops it). */
function mapMessages(
  queryClient: QueryClient,
  conversationId: string,
  fn: (m: ChatMessage) => ChatMessage | null,
) {
  queryClient.setQueryData<MessagesData>(messagesKey(conversationId), (d) =>
    d
      ? {
          ...d,
          pages: d.pages.map((p) =>
            p.flatMap((m) => {
              const r = fn(m);
              return r ? [r] : [];
            }),
          ),
        }
      : d,
  );
}

const conversationKind = (queryClient: QueryClient, id: string) =>
  queryClient.getQueryData<Conversation[]>(CONVERSATIONS_KEY)?.find((c) => c.id === id)?.kind ??
  "group";

export type SendMessageContext = { tempId: string; draft: SendMessageInput };

/** The options behind `useSendMessage`, split out so they can be driven without React.
 * The message shows at once (`id = "optimistic-…"`, `imagePath` = the local uri); on
 * any error it is removed and the draft comes back as `context.draft` in `onError`. */
export function sendMessageMutationOptions(
  cfg: ResolvedCommunityConfig,
  queryClient: QueryClient,
): UseMutationOptions<ChatMessage, Error, SendMessageInput, SendMessageContext> {
  return {
    onMutate: async (draft) => {
      const key = messagesKey(draft.conversationId);
      // Cancelling the first load would leave the conversation empty: only a refetch.
      if (queryClient.getQueryData(key)) await queryClient.cancelQueries({ queryKey: key });
      const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const target = draft.replyToId
        ? queryClient
            .getQueryData<MessagesData>(key)
            ?.pages.flat()
            .find((m) => m.id === draft.replyToId)
        : undefined;
      const optimistic: ChatMessage = {
        id: tempId,
        conversationId: draft.conversationId,
        authorId: ownAuthorFields(queryClient).authorId,
        body: draft.body ?? null,
        imagePath: draft.imageUri ?? null,
        attachment: draft.attachment ?? null,
        replyTo: draft.replyToId
          ? {
              id: draft.replyToId,
              authorId: target?.authorId ?? "",
              body: target?.status === "visible" ? target.body : null,
              deleted: !!target && (target.status === "deleted" || target.status === "hidden"),
            }
          : null,
        status: "visible",
        deletedBy: null,
        editedAt: null,
        createdAt: new Date().toISOString(),
        likeCount: 0,
        likedByMe: false,
      };
      queryClient.setQueryData<MessagesData>(key, (d) =>
        d ? { ...d, pages: [[optimistic, ...(d.pages[0] ?? [])], ...d.pages.slice(1)] } : d,
      );
      return { tempId, draft };
    },
    mutationFn: (draft) => sendMessage(cfg, draft),
    onSuccess: (message, draft, context) => {
      // A refresh may have brought the real row already: the placeholder takes its place.
      const hasTemp = !!queryClient
        .getQueryData<MessagesData>(messagesKey(draft.conversationId))
        ?.pages.some((p) => p.some((m) => m.id === context.tempId));
      mapMessages(queryClient, draft.conversationId, (m) =>
        m.id === context.tempId ? message : hasTemp && m.id === message.id ? null : m,
      );
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
      emitEvent(cfg, COMMUNITY_EVENTS.messageSent, {
        conversationId: draft.conversationId,
        messageId: message.id,
        kind: conversationKind(queryClient, draft.conversationId),
        hasImage: !!draft.imageUri,
        hasAttachment: !!draft.attachment,
        isReply: !!draft.replyToId,
      });
    },
    onError: (_error, draft, context) => {
      if (context)
        mapMessages(queryClient, draft.conversationId, (m) => (m.id === context.tempId ? null : m));
    },
  };
}

export function useSendMessage() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation(sendMessageMutationOptions(cfg, queryClient));
}

type MessageRef = { conversationId: string; messageId: string };

export function useEditMessage() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, body }: MessageRef & { body: string }) =>
      editMessage(cfg, messageId, body),
    onSuccess: (message, { conversationId, messageId }) => {
      mapMessages(queryClient, conversationId, (m) => (m.id === messageId ? message : m));
      emitEvent(cfg, COMMUNITY_EVENTS.messageEdited, { conversationId, messageId });
    },
  });
}

/** What a delete leaves, as `delete_message` does it: my own message ⇒ the author's
 * placeholder; an app admin on another's ⇒ hidden, gone from the list (null); a group
 * creator on another's ⇒ the creator's placeholder. */
export function afterDelete(m: ChatMessage, me: string, meAdmin: boolean): ChatMessage | null {
  if (m.authorId !== me && meAdmin) return null;
  return {
    ...m,
    status: "deleted",
    body: null,
    imagePath: null,
    attachment: null,
    deletedBy: m.authorId === me ? "author" : "creator",
  };
}

/** Deletes my message, or another's as the group creator / an admin. */
export function useDeleteMessage() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId }: MessageRef) => deleteMessage(cfg, messageId),
    onSuccess: (_data, { conversationId, messageId }) => {
      const { authorId: me, authorAdmin } = ownAuthorFields(queryClient);
      mapMessages(queryClient, conversationId, (m) => {
        if (m.id === messageId) return afterDelete(m, me, authorAdmin);
        if (m.replyTo?.id === messageId)
          return { ...m, replyTo: { ...m.replyTo, body: null, deleted: true } };
        return m;
      });
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
      emitEvent(cfg, COMMUNITY_EVENTS.messageDeleted, { conversationId, messageId });
    },
  });
}

/** Optimistic like toggle on the conversation's cache. */
export function useToggleMessageLike() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, liked }: MessageRef & { liked: boolean }) =>
      setMessageLike(cfg, messageId, liked),
    onMutate: async ({ conversationId, messageId, liked }) => {
      const key = messagesKey(conversationId);
      const previous = queryClient.getQueryData<MessagesData>(key);
      if (previous) await queryClient.cancelQueries({ queryKey: key });
      mapMessages(queryClient, conversationId, (m) =>
        m.id === messageId && m.likedByMe !== liked
          ? { ...m, likedByMe: liked, likeCount: Math.max(0, m.likeCount + (liked ? 1 : -1)) }
          : m,
      );
      return { previous };
    },
    onError: (_e, { conversationId }, context) => {
      if (context?.previous)
        queryClient.setQueryData(messagesKey(conversationId), context.previous);
    },
    onSuccess: (_data, { conversationId, messageId, liked }) => {
      if (liked) emitEvent(cfg, COMMUNITY_EVENTS.messageLiked, { conversationId, messageId });
    },
  });
}

/** A message in the reader's locale; resolves to the translated text. */
export function useTranslateMessage() {
  const cfg = useCommunityConfig();
  return useMutation({
    mutationFn: ({ messageId }: MessageRef) =>
      translateMessage(cfg, messageId, readerLocale(cfg) ?? cfg.host.getLocale()),
    onSuccess: (_text, { conversationId, messageId }) =>
      emitEvent(cfg, COMMUNITY_EVENTS.messageTranslated, { conversationId, messageId }),
  });
}

/** While mounted and `active`: marks the conversation read now, on each new message, and
 * whenever the app comes back to the foreground. `active`: the chat screen has the focus
 * (pass the navigator's `useIsFocused()`), so a chat covered by another screen stays unread. */
export function useMarkConversationRead(conversationId: string | null, active = true): void {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  const enabled = messagingEnabled(cfg) && !!conversationId && active;
  useEffect(() => {
    if (!enabled || !conversationId) return;
    const key = messagesKey(conversationId);
    const hash = hashKey(key);
    const newest = () =>
      queryClient.getQueryData<MessagesData>(key)?.pages[0]?.find((m) => !isOptimistic(m))?.id;
    let marked: string | undefined | null = null;
    const mark = () => {
      if (!focusManager.isFocused()) return;
      marked = newest();
      markConversationRead(cfg, conversationId).then(
        () => {
          queryClient.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) =>
            list?.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)),
          );
          void queryClient.invalidateQueries({ queryKey: UNREAD_MESSAGES_KEY });
        },
        () => {}, // the next message or focus tries again
      );
    };
    mark();
    const stopCache = queryClient.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.query.queryHash === hash && newest() !== marked) mark();
    });
    const stopFocus = focusManager.subscribe((focused) => {
      if (focused) mark();
    });
    return () => {
      stopCache();
      stopFocus();
    };
  }, [cfg, queryClient, conversationId, enabled]);
}

// ============ TYPING ============

/** The ids typing now; each expires `ttlMs` after its last event. */
export function createTypingTracker(onChange: (ids: string[]) => void, ttlMs = TYPING_TTL_MS) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const emit = () => onChange([...timers.keys()]);
  return {
    add(userId: string) {
      const isNew = !timers.has(userId);
      clearTimeout(timers.get(userId));
      timers.set(
        userId,
        setTimeout(() => {
          timers.delete(userId);
          emit();
        }, ttlMs),
      );
      if (isNew) emit();
    },
    stop() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

/** Who is typing in the conversation, and `notifyTyping` to call on each keystroke
 * (throttled). Nothing when `messaging.typingIndicator` is false. */
export function useTyping(conversationId: string | null): {
  typingUserIds: string[];
  notifyTyping(): void;
} {
  const cfg = useCommunityConfig();
  const on =
    messagingEnabled(cfg) && messagingSettings(cfg)?.typingIndicator === true && !!conversationId;
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  useEffect(() => {
    if (!on || !conversationId) return;
    const tracker = createTypingTracker(setTypingUserIds);
    const stop = subscribeConversation(cfg, conversationId, {
      onChange: () => {},
      onTyping: tracker.add,
    });
    return () => {
      stop();
      tracker.stop();
      setTypingUserIds([]);
    };
  }, [cfg, conversationId, on]);
  const notifyTyping = useCallback(() => {
    if (on && conversationId) sendTyping(cfg, conversationId);
  }, [cfg, conversationId, on]);
  return { typingUserIds: on ? typingUserIds : [], notifyTyping };
}

// ============ GROUPS ============

/** Visible groups, latest activity first; an empty query lists them all. */
export function useGroupSearch(query: string) {
  const cfg = useCommunityConfig();
  const cleaned = query.trim();
  const locale = readerLocale(cfg);
  return useInfiniteQuery({
    queryKey: [...GROUPS_SEARCH_KEY, cleaned, locale ?? "src"],
    queryFn: ({ pageParam }) => searchGroups(cfg, { query: cleaned, before: pageParam }),
    initialPageParam: undefined as { id: string; lastActivityAt: string } | undefined,
    getNextPageParam: (last: Group[]) => {
      const g = last[last.length - 1];
      return last.length >= GROUPS_PAGE_SIZE && g
        ? { id: g.id, lastActivityAt: g.lastActivityAt }
        : undefined;
    },
    enabled: messagingEnabled(cfg),
    staleTime: 30_000,
    retry: 1,
  });
}

/** One group; null when unreadable or deleted. */
export function useGroup(id: string | null) {
  const cfg = useCommunityConfig();
  const locale = readerLocale(cfg);
  return useQuery({
    queryKey: groupKey(id ?? "none", locale),
    queryFn: () => fetchGroup(cfg, id!),
    enabled: messagingEnabled(cfg) && !!id,
    staleTime: 30_000,
    retry: 1,
  });
}

/** A group's active members, the creator first (members only). */
export function useGroupMembers(id: string | null, query = "") {
  const cfg = useCommunityConfig();
  const cleaned = query.trim();
  return useInfiniteQuery({
    queryKey: [...groupMembersKey(id ?? "none"), cleaned],
    queryFn: ({ pageParam }) => fetchGroupMembers(cfg, id!, { query: cleaned, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last: unknown[], all: unknown[][]) =>
      last.length >= GROUP_MEMBERS_PAGE_SIZE ? all.length * GROUP_MEMBERS_PAGE_SIZE : undefined,
    enabled: messagingEnabled(cfg) && !!id,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Online members per group (presence module); `{}` when off or not loaded. */
export function useGroupOnlineCounts(ids: string[]): Record<string, number> {
  const cfg = useCommunityConfig();
  const enabled = messagingEnabled(cfg) && !!cfg.modules.presence && ids.length > 0;
  const q = useQuery({
    queryKey: [...GROUPS_KEY, "online", [...ids].sort()],
    queryFn: () => fetchGroupOnlineCounts(cfg, ids),
    enabled,
    refetchInterval: PRESENCE_POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    retry: 1,
  });
  return enabled ? (q.data ?? {}) : {};
}

const invalidateGroups = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: GROUPS_KEY }),
    queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
    queryClient.invalidateQueries({ queryKey: UNREAD_MESSAGES_KEY }),
  ]);

/** Creates a group (pending until moderation approves it); resolves to its id. */
export function useCreateGroup() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description: string; imageUri?: string }) =>
      createGroup(cfg, input),
    onSuccess: (groupId) => {
      void invalidateGroups(queryClient);
      emitEvent(cfg, COMMUNITY_EVENTS.groupCreated, { groupId });
    },
  });
}

export function useEditGroup() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      ...input
    }: {
      groupId: string;
      name?: string;
      description?: string;
      imageUri?: string;
    }) => editGroup(cfg, groupId, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: GROUPS_KEY }),
  });
}

/** `source`: where the join was tapped (explore, preview, share card…), for analytics. */
export function useJoinGroup() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId }: { groupId: string; source?: string }) => joinGroup(cfg, groupId),
    onSuccess: (_d, { groupId, source }) => {
      void invalidateGroups(queryClient);
      emitEvent(cfg, COMMUNITY_EVENTS.groupJoined, { groupId, source: source ?? null });
    },
  });
}

export function useLeaveGroup() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId }: { groupId: string }) => leaveGroup(cfg, groupId),
    onSuccess: (_d, { groupId }) => {
      void invalidateGroups(queryClient);
      emitEvent(cfg, COMMUNITY_EVENTS.groupLeft, { groupId });
    },
  });
}

/** Follow (push + badge) or mute a group, optimistically on the conversation list. */
export function useSetGroupNotify() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, notify }: { groupId: string; notify: boolean }) =>
      setGroupNotify(cfg, groupId, notify),
    onMutate: async ({ groupId, notify }) => {
      await queryClient.cancelQueries({ queryKey: CONVERSATIONS_KEY });
      const previous = queryClient.getQueryData<Conversation[]>(CONVERSATIONS_KEY);
      queryClient.setQueryData<Conversation[]>(CONVERSATIONS_KEY, (list) =>
        list?.map((c) => (c.id === groupId ? { ...c, notify } : c)),
      );
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous) queryClient.setQueryData(CONVERSATIONS_KEY, context.previous);
    },
    onSuccess: (_d, { groupId, notify }) =>
      emitEvent(cfg, COMMUNITY_EVENTS.groupNotificationsToggled, { groupId, on: notify }),
    onSettled: () => invalidateGroups(queryClient),
  });
}

/** The creator removes a member. */
export function useRemoveMember() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      removeMember(cfg, groupId, userId),
    onSuccess: (_d, { groupId }) => {
      void queryClient.invalidateQueries({ queryKey: groupMembersKey(groupId) });
      void queryClient.invalidateQueries({ queryKey: [...GROUPS_KEY, "group", groupId] });
    },
  });
}

/** The creator lets a removed member back in (they may join again). */
export function useReadmitMember() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      readmitMember(cfg, groupId, userId),
    onSuccess: (_d, { groupId }) =>
      void queryClient.invalidateQueries({ queryKey: groupMembersKey(groupId) }),
  });
}
