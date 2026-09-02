import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedPost } from "./models";

export type CommunityTopicDef = { id: string; officialOnly?: boolean };

export type CommunityModules = {
  polls: boolean;
  push: boolean;
  inbox: boolean;
  reaction: { key: string } | false;
};

export type CommunityHostAdapters = {
  getDisplayName?: () => string | null;
  getAnalyticsIds?: () => { amplitudeId?: string; revenuecatId?: string };
  onEvent?: (name: string, props: Record<string, unknown>) => void;
  rulesAcceptance?: { get(): Promise<boolean>; set(): Promise<void> };
  onContentPublished?: () => void;
  getLocale?: () => string;
};

/**
 * Host-defined extension point for the raw `posts` row shape and its mapped
 * `FeedPost` output — added for hosts (e.g. Nightward) that store extra
 * columns on `posts` (like a seed-likes top-up) the shared schema doesn't
 * know about. Both fields are optional and default to a no-op, so a host
 * that never sets `feed` gets byte-identical behavior to before this existed.
 *
 * `transformPost` only runs on rows fetched from the backend (`fetchFeedPage`,
 * `fetchUserPosts`, `searchPosts` — see `mapPostRow` call sites in
 * `service.ts`). It does NOT run on the optimistic post shown immediately
 * after `createPost` (there is no raw row yet) — that post renders untransformed
 * until the next refetch replaces it with a server-mapped one. `fetchThread`
 * queries `comments`, not `posts`, so `extraPostColumns`/`transformPost` don't
 * apply there.
 */
export type CommunityFeedConfig = {
  /** Appended to the posts select in every posts-table query. Only
   * `[a-z0-9_]+` column names are accepted; anything else is dropped with a
   * `console.warn` (minimal guard against passing a crafted select fragment). */
  extraPostColumns?: string[];
  /** Applied to every server-mapped `FeedPost`, given the raw row (including
   * any `extraPostColumns`) it was built from. */
  transformPost?: (post: FeedPost, row: Record<string, unknown>) => FeedPost;
};

export type CommunityConfig = {
  supabase: SupabaseClient | null;
  appName: string;
  anonymousAuthorFallback: string;
  topics: CommunityTopicDef[];
  modules: CommunityModules;
  host?: CommunityHostAdapters;
  feed?: CommunityFeedConfig;
};

export class CommunityDisabledError extends Error {
  constructor() {
    super("community backend not configured");
    this.name = "CommunityDisabledError";
  }
}

type RequiredCommunityHostAdapters = Required<CommunityHostAdapters>;

export type ResolvedCommunityConfig = CommunityConfig & {
  host: RequiredCommunityHostAdapters;
  feed: CommunityFeedConfig;
  requireClient(): SupabaseClient;
  composeTopics(): CommunityTopicDef[];
  isOfficialTopic(id: string): boolean;
};

let warned = false;

const defaultHost: RequiredCommunityHostAdapters = {
  getDisplayName: () => null,
  getAnalyticsIds: () => ({}),
  onEvent: () => {},
  rulesAcceptance: {
    get: async () => false,
    set: async () => {},
  },
  onContentPublished: () => {},
  getLocale: () => "en",
};

export function resolveConfig(config: CommunityConfig): ResolvedCommunityConfig {
  const host: RequiredCommunityHostAdapters = {
    ...defaultHost,
    ...config.host,
  };

  const resolved: ResolvedCommunityConfig = {
    ...config,
    host,
    feed: config.feed ?? {},
    requireClient(): SupabaseClient {
      if (!resolved.supabase) {
        if (!warned) {
          warned = true;
          console.warn(
            "[@rocapine/community-core] community backend not configured — running in degraded mode.",
          );
        }
        throw new CommunityDisabledError();
      }
      return resolved.supabase;
    },
    composeTopics(): CommunityTopicDef[] {
      return resolved.topics.filter((topic) => !topic.officialOnly);
    },
    isOfficialTopic(id: string): boolean {
      return resolved.topics.some((topic) => topic.id === id && topic.officialOnly === true);
    },
  };

  return Object.freeze(resolved);
}
