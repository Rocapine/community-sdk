export type { CommunityTheme, DeepPartial, ShadowToken } from "./theme";
export { defaultTheme, mergeTheme } from "./theme";

export type { TFn } from "./i18n";
export { makeT } from "./i18n";

export { en } from "./locales/en";
export { esES } from "./locales/es-ES";
export { es419 } from "./locales/es-419";
export { it } from "./locales/it";
export { pl } from "./locales/pl";
export { ptPT } from "./locales/pt-PT";
export { ptBR } from "./locales/pt-BR";

// Re-exported so hosts typing a `renderInboxRow` callback for
// `NotificationInboxScreen` (whose prop signature is
// `(item: InboxItem, defaults: ReactNode | null) => ReactNode`) don't need a
// direct dependency on @rocapine/community-core just for this one type.
export type { InboxItem } from "@rocapine/community-core";

export { CommunityUIProvider, useCommunityTheme, useT, useThemedStyles } from "./ThemeProvider";

export { CommunitySheet } from "./Sheet";

export type { PostSlots } from "./components/CommunityPost";
export { CommunityPost } from "./components/CommunityPost";
export { PollBlock } from "./components/PollBlock";
export { NoticeCard } from "./components/NoticeCard";
export { ComposerCard } from "./components/ComposerCard";
export { RulesSheet } from "./components/RulesSheet";
export type { ReportTarget } from "./components/ReportSheet";
export { ReportSheet } from "./components/ReportSheet";

export { CommunityFeedScreen } from "./screens/CommunityFeedScreen";
export { ThreadSheet } from "./screens/ThreadSheet";
export { ProfileScreen } from "./screens/ProfileScreen";
export { ProfileEditSheet } from "./screens/ProfileEditSheet";
export { NotificationInboxScreen } from "./screens/NotificationInboxScreen";
