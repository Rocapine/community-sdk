// React Query hooks over the inbox service. Ported from a host app's
// notification-center hooks, gated on `cfg.modules.inbox` in addition
// to the usual `cfg.supabase !== null` degraded-mode guard.
//
// No React Native / analytics-SDK / store imports here.

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";

import { useCommunityConfig } from "./provider";
import {
  fetchInbox,
  markInboxItemRead,
  isUnread,
  markInboxSeen,
  unreadCount,
  type InboxState,
} from "./inbox-service";

const INBOX_KEY = ["community", "inbox"] as const;

/**
 * The inbox, shared by the host's badge and the center screen — one query
 * key backs both, so opening the screen never triggers a second fetch on top
 * of the badge's. Refreshes on foreground like every query (host's own
 * focusManager wiring, same as the rest of this package).
 */
export function useNotificationInbox(): UseQueryResult<InboxState> {
  const cfg = useCommunityConfig();
  return useQuery<InboxState>({
    queryKey: INBOX_KEY,
    queryFn: () => fetchInbox(cfg),
    enabled: cfg.supabase !== null && cfg.modules.inbox,
    staleTime: 60_000,
    // Like the new-posts count: the badge stays honest while the app is open,
    // even for a reader without push.
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/**
 * Unread badge count. Fail-soft rule (mold): the inbox is an enhancement, so a
 * fetch error, a disabled module, or a degraded (no-backend) host must never
 * surface upstream — this returns 0 in every one of those cases, never
 * `undefined` and never a thrown error.
 */
export function useUnreadNotificationCount(): number {
  const { data } = useNotificationInbox();
  return data ? unreadCount(data.items, data.seenAt, data.readIds) : 0;
}

/**
 * Moves the seen marker past everything currently in the inbox so the badge
 * clears immediately (optimistic), then persists the clock-skew-safe marker
 * server-side (see `markInboxSeen`) — the next fetch reconciles the cache
 * with that authoritative value.
 */
export function useMarkInboxSeen() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markInboxSeen(cfg),
    onMutate: () => {
      const optimisticSeenAt = new Date().toISOString();
      queryClient.setQueryData<InboxState>(INBOX_KEY, (state) =>
        state ? { ...state, seenAt: optimisticSeenAt } : state,
      );
    },
  });
}

/** Marks one item read (`readMode: "tap"`), optimistically. */
export function useMarkInboxItemRead() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => markInboxItemRead(cfg, itemId),
    onMutate: (itemId) => {
      queryClient.setQueryData<InboxState>(INBOX_KEY, (state) =>
        state && !state.readIds.includes(itemId)
          ? { ...state, readIds: [...state.readIds, itemId] }
          : state,
      );
    },
  });
}

/**
 * Marks read the unread items about one post, e.g. the post a tapped push is
 * about. `kind` narrows them to one kind and takes the push's own kind
 * (`community_like`) as well as the inbox's (`like`). Refetches first: the
 * push is newer than the cached inbox. Fail-soft, like the badge.
 */
export function useMarkPostNotificationsRead(): (postId: string, kind?: string) => Promise<void> {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useCallback(
    async (postId, kind) => {
      if (cfg.supabase === null || !cfg.modules.inbox) return;
      const itemKind = kind?.replace(/^community_/, "");
      try {
        const state = await queryClient.fetchQuery({
          queryKey: INBOX_KEY,
          queryFn: () => fetchInbox(cfg),
          staleTime: 0,
        });
        const ids = state.items
          .filter(
            (item) =>
              item.postId === postId &&
              (!itemKind || item.kind === itemKind) &&
              isUnread(item, state.seenAt, state.readIds),
          )
          .map((item) => item.id);
        if (ids.length === 0) return;
        queryClient.setQueryData<InboxState>(INBOX_KEY, (s) =>
          s ? { ...s, readIds: [...s.readIds, ...ids.filter((id) => !s.readIds.includes(id))] } : s,
        );
        await Promise.all(ids.map((id) => markInboxItemRead(cfg, id)));
      } catch {
        // The next inbox fetch shows whatever stayed unread.
      }
    },
    [cfg, queryClient],
  );
}
