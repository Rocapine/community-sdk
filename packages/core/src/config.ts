import type { SupabaseClient } from "@supabase/supabase-js";

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

export type CommunityConfig = {
  supabase: SupabaseClient | null;
  appName: string;
  anonymousAuthorFallback: string;
  topics: CommunityTopicDef[];
  modules: CommunityModules;
  host?: CommunityHostAdapters;
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
