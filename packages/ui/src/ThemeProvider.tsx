import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from "react";
import { defaultTheme, mergeTheme, type CommunityTheme, type DeepPartial } from "./theme";
import { makeT, type TFn } from "./i18n";

const ThemeContext = createContext<CommunityTheme>(defaultTheme);
const TranslationContext = createContext<TFn>(makeT("en"));

export function CommunityUIProvider(props: {
  theme?: DeepPartial<CommunityTheme>;
  translations?: { locale?: string; overrides?: Record<string, string> };
  children: ReactNode;
}): ReactElement {
  const { theme, translations, children } = props;
  const locale = translations?.locale ?? "en";
  const overrides = translations?.overrides;

  const resolvedTheme = useMemo(() => mergeTheme(theme), [theme]);
  const t = useMemo(() => makeT(locale, overrides), [locale, overrides]);

  return (
    <ThemeContext.Provider value={resolvedTheme}>
      <TranslationContext.Provider value={t}>{children}</TranslationContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useCommunityTheme(): CommunityTheme {
  return useContext(ThemeContext);
}

export function useT(): TFn {
  return useContext(TranslationContext);
}

/**
 * Memoized themed StyleSheet — mirrors the mold's own `useThemedStyles`
 * (`sdk/client/components/community/theme.tsx`). Pass a module-level factory
 * `(theme) => StyleSheet.create({...})`; it recomputes only when the theme
 * object identity changes, not on every render. Matters for components that
 * re-render often (e.g. `CommunityPost` inside a `FlatList`) — without this,
 * every render would rebuild the whole style object from scratch.
 */
export function useThemedStyles<T>(factory: (theme: CommunityTheme) => T): T {
  const theme = useCommunityTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}
