import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from "react";
import { defaultTheme, mergeTheme, type CommunityTheme, type DeepPartial } from "./theme";
import { makeT, type TFn } from "./i18n";
import { defaultIcons, mergeIcons } from "./icons-default";
import type { CommunityIconSet } from "./icons";
import type { AvatarRenderProps } from "./components/Avatar";

const ThemeContext = createContext<CommunityTheme>(defaultTheme);
const TranslationContext = createContext<TFn>(makeT("en"));
const IconsContext = createContext<CommunityIconSet>(defaultIcons);
const AvatarContext = createContext<((p: AvatarRenderProps) => ReactNode) | null>(null);

export function CommunityUIProvider(props: {
  theme?: DeepPartial<CommunityTheme>;
  translations?: { locale?: string; overrides?: Record<string, string> };
  /** Overrides part or all of the built-in expo-symbols icon set — a
   * host that supplies every `CommunityIconName` never needs
   * expo-symbols installed at all (see `icons.ts`/`icons-default.ts`). */
  icons?: Partial<CommunityIconSet>;
  /** Draws every user avatar the SDK shows (feed, comments, profiles, header
   * button, composer). Without it: the photo, else the initial on a flat colour. */
  renderAvatar?: (p: AvatarRenderProps) => ReactNode;
  children: ReactNode;
}): ReactElement {
  const { theme, translations, icons, renderAvatar, children } = props;
  const locale = translations?.locale ?? "en";
  const overrides = translations?.overrides;

  const resolvedTheme = useMemo(() => mergeTheme(theme), [theme]);
  const t = useMemo(() => makeT(locale, overrides), [locale, overrides]);
  const resolvedIcons = useMemo<CommunityIconSet>(() => mergeIcons(icons), [icons]);

  return (
    <ThemeContext.Provider value={resolvedTheme}>
      <TranslationContext.Provider value={t}>
        <IconsContext.Provider value={resolvedIcons}>
          <AvatarContext.Provider value={renderAvatar ?? null}>{children}</AvatarContext.Provider>
        </IconsContext.Provider>
      </TranslationContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useCommunityTheme(): CommunityTheme {
  return useContext(ThemeContext);
}

/** The host's `renderAvatar`, or null for the SDK's default (see `Avatar`). */
export function useAvatarRenderer(): ((p: AvatarRenderProps) => ReactNode) | null {
  return useContext(AvatarContext);
}

export function useT(): TFn {
  return useContext(TranslationContext);
}

/** The resolved icon set (built-in defaults merged with any `icons`
 * override passed to `CommunityUIProvider`) — pick a component off it by
 * `CommunityIconName`, e.g. `const Menu = useCommunityIcons().menu`. */
export function useCommunityIcons(): CommunityIconSet {
  return useContext(IconsContext);
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
