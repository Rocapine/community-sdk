import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CommunityProvider,
  syncProfileFromHost,
  useCommunityConfig,
} from "@rocapine/community-core";
import { CommunityUIProvider } from "@rocapine/community-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PlaygroundAvatar } from "./components/PlaygroundAvatar";
import { renderPlaygroundBadge } from "./components/PlaygroundBadge";
import {
  openPlaygroundAttachment,
  renderPlaygroundAttachment,
} from "./components/PlaygroundAttachment";
import {
  BACKGROUNDS,
  BADGE_COPY,
  buildConfig,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  type PlaygroundSettings,
} from "./playground";

type Playground = {
  settings: PlaygroundSettings;
  update(patch: Partial<PlaygroundSettings>): void;
  reset(): void;
};

const PlaygroundContext = createContext<Playground | null>(null);

const queryClient = new QueryClient();

/** Stored settings from an older version of this app lack the newer fields: fill
 * each section from the defaults. */
function withDefaults(stored: Partial<PlaygroundSettings>): PlaygroundSettings {
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const [key, value] of Object.entries(stored)) {
    const base = out[key];
    out[key] =
      base && typeof base === "object" && value && typeof value === "object"
        ? { ...base, ...value }
        : value;
  }
  return out as PlaygroundSettings;
}

export function usePlayground(): Playground {
  const value = useContext(PlaygroundContext);
  if (!value) throw new Error("usePlayground outside PlaygroundProvider");
  return value;
}

export function PlaygroundProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PlaygroundSettings | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => setSettings(raw ? withDefaults(JSON.parse(raw)) : DEFAULT_SETTINGS))
      .catch(() => setSettings(DEFAULT_SETTINGS));
  }, []);

  const playground = useMemo<Playground | null>(() => {
    if (!settings) return null;
    const save = (next: PlaygroundSettings) => {
      setSettings(next);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
    };
    return {
      settings,
      update: (patch) => save({ ...settings, ...patch }),
      reset: () => save(DEFAULT_SETTINGS),
    };
  }, [settings]);

  const config = useMemo(() => (settings ? buildConfig(settings) : null), [settings]);

  if (!playground || !config) return null;
  const { colors, locale, modules, typography, admin, backgrounds, badges } = playground.settings;
  const communityImage = BACKGROUNDS[backgrounds.community];
  const theme = {
    colors: { ...colors, ...(admin.nameColor ? { adminName: admin.nameColor } : {}) },
    typography: {
      title: typography.titleFont ? { fontFamily: typography.titleFont } : {},
      body: { fontSize: typography.bodySize },
    },
  };
  return (
    <PlaygroundContext.Provider value={playground}>
      <QueryClientProvider client={queryClient}>
        {/* The SDK reads its config once: a module or locale switch remounts it. */}
        <CommunityProvider
          key={JSON.stringify({
            modules,
            locale,
            badges,
            reaction: playground.settings.reaction,
            attachments: playground.settings.attachments,
          })}
          config={config}
        >
          <SyncFromHost />
          <CommunityUIProvider
            theme={theme}
            translations={{ locale, overrides: BADGE_COPY }}
            renderMemberBadge={renderPlaygroundBadge}
            renderAttachment={renderPlaygroundAttachment}
            onOpenAttachment={openPlaygroundAttachment}
            background={
              communityImage
                ? { image: communityImage, opacity: backgrounds.communityOpacity }
                : undefined
            }
            renderAvatar={(p) => (
              <PlaygroundAvatar {...p} ring={admin.ring} accent={colors.accent} />
            )}
          >
            {children}
          </CommunityUIProvider>
        </CommunityProvider>
      </QueryClientProvider>
    </PlaygroundContext.Provider>
  );
}

/** What a host does at launch: mirror its name, locale and badges onto the profile. */
function SyncFromHost() {
  const cfg = useCommunityConfig();
  useEffect(() => {
    syncProfileFromHost(cfg).catch(() => {});
  }, [cfg]);
  return null;
}
