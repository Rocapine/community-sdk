// Online presence hooks. Every query is off unless the `presence` module is on and a
// backend is configured.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { presenceSettings, type ResolvedCommunityConfig } from "./config";
import { COMMUNITY_EVENTS, emitEvent } from "./events";
import {
  createOnlineBatcher,
  fetchMyPresenceVisible,
  fetchOnlineCount,
  fetchOnlineIds,
  setPresenceVisible,
} from "./presence";
import { useCommunityConfig } from "./provider";

export const PRESENCE_KEY = ["community", "presence"] as const;
export const PRESENCE_POLL_MS = 60_000;
const STALE_MS = 30_000;

// Time to the next wall-clock minute: every observer polls at the same instant,
// so the batcher sends one online_member_ids per minute, not one per mount group.
// TanStack recomputes a function refetchInterval after each fetch.
const untilNextPoll = () => PRESENCE_POLL_MS - (Date.now() % PRESENCE_POLL_MS);

const presenceEnabled = (cfg: ResolvedCommunityConfig) =>
  presenceSettings(cfg) !== null && cfg.supabase !== null;

const batchers = new WeakMap<ResolvedCommunityConfig, (id: string) => Promise<boolean>>();
function batcherFor(cfg: ResolvedCommunityConfig) {
  let b = batchers.get(cfg);
  if (!b) {
    b = createOnlineBatcher((ids) => fetchOnlineIds(cfg, ids));
    batchers.set(cfg, b);
  }
  return b;
}

export function onlineCountQueryOptions(cfg: ResolvedCommunityConfig) {
  return {
    queryKey: [...PRESENCE_KEY, "count"] as const,
    queryFn: () => fetchOnlineCount(cfg),
    refetchInterval: untilNextPoll,
    refetchIntervalInBackground: false,
    retry: 1,
    staleTime: STALE_MS,
    enabled: presenceEnabled(cfg),
  };
}

export function isOnlineQueryOptions(cfg: ResolvedCommunityConfig, userId: string | null) {
  return {
    queryKey: [...PRESENCE_KEY, "online", userId] as const,
    queryFn: () => batcherFor(cfg)(userId as string),
    refetchInterval: untilNextPoll,
    refetchIntervalInBackground: false,
    retry: 1,
    staleTime: STALE_MS,
    enabled: presenceEnabled(cfg) && userId !== null,
  };
}

/** Members online now; null when presence is off or not loaded yet. */
export function useOnlineCount(): number | null {
  const cfg = useCommunityConfig();
  return useQuery(onlineCountQueryOptions(cfg)).data ?? null;
}

/** Whether a member is online; false when presence is off or loading. */
export function useIsOnline(userId: string | null): boolean {
  const cfg = useCommunityConfig();
  return useQuery(isOnlineQueryOptions(cfg, userId)).data ?? false;
}

/** Whether the owner shows as online to others; null until loaded. */
export function usePresenceVisible(): boolean | null {
  const cfg = useCommunityConfig();
  return (
    useQuery({
      queryKey: [...PRESENCE_KEY, "visible"] as const,
      queryFn: () => fetchMyPresenceVisible(cfg),
      enabled: presenceEnabled(cfg),
      retry: 1,
    }).data ?? null
  );
}

export function presenceVisibilityMutationOptions(
  cfg: ResolvedCommunityConfig,
  queryClient: QueryClient,
): UseMutationOptions<void, Error, boolean> {
  return {
    scope: { id: "community-presence-visibility" },
    mutationFn: (visible) => setPresenceVisible(cfg, visible),
    onSuccess: (_data, visible) => {
      void queryClient.invalidateQueries({ queryKey: PRESENCE_KEY });
      emitEvent(cfg, COMMUNITY_EVENTS.presenceVisibilityChanged, { visible });
    },
  };
}

export function useSetPresenceVisible() {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  return useMutation(presenceVisibilityMutationOptions(cfg, queryClient));
}
