// The `CommunityConfig` this demo hands to `<CommunityProvider>`. Kept in
// its own file (task brief) so it reads as "the one thing a host app wires
// up", separate from the screen-switching shell in `App.tsx`.
//
// Degraded mode: when EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY
// are unset (e.g. `npx expo start` with no `.env`), `supabase` below is
// `null` — `@rocapine/community-core` renders empty states everywhere and
// logs exactly one console warning the first time a query actually needs
// the client (`resolveConfig`'s `requireClient()`), never crashing.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import type { CommunityConfig } from "@rocapine/community-core";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const config: CommunityConfig = {
  supabase:
    url && key
      ? createClient(url, key, { auth: { storage: AsyncStorage, persistSession: true } })
      : null,
  appName: "Community SDK Demo",
  anonymousAuthorFallback: "Someone",
  topics: [{ id: "general" }, { id: "question" }, { id: "news", officialOnly: true }],
  modules: { polls: true, push: false, inbox: true, reaction: { key: "cheer" } },
  host: {
    onEvent: (name, props) => console.log("[event]", name, props),
  },
};
