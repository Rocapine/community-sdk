import AsyncStorage from "@react-native-async-storage/async-storage";
import { CommunityProvider } from "@rocapine/community-core";
import { CommunityUIProvider } from "@rocapine/community-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildConfig, DEFAULT_SETTINGS, STORAGE_KEY, type PlaygroundSettings } from "./playground";

type Playground = {
  settings: PlaygroundSettings;
  update(patch: Partial<PlaygroundSettings>): void;
  reset(): void;
};

const PlaygroundContext = createContext<Playground | null>(null);

const queryClient = new QueryClient();

export function usePlayground(): Playground {
  const value = useContext(PlaygroundContext);
  if (!value) throw new Error("usePlayground outside PlaygroundProvider");
  return value;
}

export function PlaygroundProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PlaygroundSettings | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) =>
        setSettings(raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS),
      )
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
  const { colors, locale, modules } = playground.settings;
  return (
    <PlaygroundContext.Provider value={playground}>
      <QueryClientProvider client={queryClient}>
        {/* The SDK reads its config once: a module or locale switch remounts it. */}
        <CommunityProvider key={JSON.stringify({ modules, locale })} config={config}>
          <CommunityUIProvider theme={{ colors }} translations={{ locale }}>
            {children}
          </CommunityUIProvider>
        </CommunityProvider>
      </QueryClientProvider>
    </PlaygroundContext.Provider>
  );
}
