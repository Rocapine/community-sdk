export type { CommunityTheme, DeepPartial, ShadowToken } from "./theme";
export { defaultTheme, mergeTheme } from "./theme";

export type { TFn } from "./i18n";
export { makeT } from "./i18n";

export { en } from "./locales/en";

export { CommunityUIProvider, useCommunityTheme, useT } from "./ThemeProvider";
