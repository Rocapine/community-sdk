// What the Config tab edits, and how it becomes the SDK's config. Every option a
// community-sdk PR adds gets a field here and a control in `app/(tabs)/config.tsx`,
// so each one can be tried on the scratch backend without touching code.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CommunityConfig } from "@rocapine/community-core";

export type PlaygroundSettings = {
  locale: string;
  modules: {
    polls: boolean;
    inbox: boolean;
    reaction: boolean;
    translation: boolean;
    images: boolean;
    streaks: boolean;
  };
  colors: { accent: string; background: string };
  /** `title` role font (null = the theme's serif default) and `body` role size. */
  typography: { titleFont: string | null; bodySize: number };
};

export const DEFAULT_SETTINGS: PlaygroundSettings = {
  locale: "en",
  modules: {
    polls: true,
    inbox: true,
    reaction: true,
    translation: true,
    images: true,
    streaks: true,
  },
  colors: { accent: "#6C4DF6", background: "#F7F7F8" },
  typography: { titleFont: null, bodySize: 15 },
};

/** Fonts every iOS device has, to try the `title` role without bundling one. */
export const TITLE_FONTS = ["Georgia", "Courier New", "Avenir Next", "Snell Roundhand"] as const;

/** The 13 locales `@rocapine/community-ui` ships. */
export const LOCALES = [
  "en",
  "es-ES",
  "es-419",
  "fr",
  "fr-vous",
  "de",
  "it",
  "pl",
  "pt-PT",
  "pt-BR",
  "ko",
  "ro",
  "uk",
] as const;

export const STORAGE_KEY = "playground.settings.v1";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

// One client for the app's lifetime: rebuilding it on every settings change would
// drop the session.
const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, { auth: { storage: AsyncStorage, persistSession: true } })
    : null;

export function buildConfig(settings: PlaygroundSettings): CommunityConfig {
  const m = settings.modules;
  return {
    supabase,
    appName: "Community SDK Demo",
    topics: [{ id: "general" }, { id: "question" }, { id: "news", officialOnly: true }],
    modules: {
      polls: m.polls,
      push: false,
      inbox: m.inbox,
      reaction: m.reaction ? { key: "cheer" } : false,
      // Must match the scratch backend's COMMUNITY_TRANSLATION_LOCALES.
      translation: m.translation ? { locales: ["en", "es-419", "pt-BR"] } : false,
      images: m.images,
      streaks: m.streaks,
    },
    host: {
      getLocale: () => settings.locale,
      onEvent: (name, props) => console.log("[event]", name, props),
    },
  };
}
