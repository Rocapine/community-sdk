// Theme tokens for @rocapine/community-ui.
//
// The `colors`/`fonts` shape is the union of two sources:
//  1. The task brief's proposed CommunityTheme.
//  2. The mold seam (`sdk/client/components/community/theme.tsx` in the
//     internal reference implementation) — the Palette/fonts contract every
//     existing community component actually consumes. Reconciled here so
//     Tasks 10-13 (porting those components) never hit a token this file
//     doesn't define.
//
// Every token added beyond the brief is called out below with the mold
// field that motivated it. See the internal port notes for the full table.

/** Deep-partial utility used by `mergeTheme`. Functions and arrays are left
 * intact (not recursed into) so `spacing` stays a single replaceable unit. */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepPartial<U>[]
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/** Card/sheet elevation. Added beyond the brief — mold: `Palette.shadow`
 * (`ShadowToken`), consumed by the primitive Card component in `ui.tsx`. */
export interface ShadowToken {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

export type CommunityTheme = {
  colors: {
    background: string;
    surface: string;
    surfaceMuted: string;
    border: string;
    /** Added beyond the brief — mold: `Palette.borderStrong`, used for
     * emphasized borders (selected poll option, avatar ring, sheet border). */
    borderStrong: string;
    /** Added beyond the brief — mold: `Palette.hairline`, the subtlest
     * divider line, distinct from `border`/`borderStrong` (mold's own
     * "stroke intensities" 3-tier system). */
    hairline: string;
    textPrimary: string;
    textSecondary: string;
    /** Added beyond the brief — mold: `Palette.textMuted`, a third text
     * intensity between `textSecondary` (body) and `textFaint` (placeholder/
     * disabled), used for meta lines (handle · timestamp). */
    textMuted: string;
    /** Added beyond the brief — mold: `Palette.textFaint`, the faintest
     * text tier (placeholders, disabled icons). */
    textFaint: string;
    textInverse: string;
    accent: string;
    accentSoft: string;
    danger: string;
    success: string;
    like: string;
    official: string;
    pinned: string;
  };
  fonts: {
    // NOTE: widened from the brief's `string` to `string | undefined` — the
    // brief itself requires `defaultTheme` to be "undefined-font-safe
    // (system font)", which the non-optional `string` type in the brief's
    // literal proposal cannot express. Matches the mold's own font contract
    // (`Record<Keys, string | undefined>`).
    regular: string | undefined;
    medium: string | undefined;
    bold: string | undefined;
    /** Added beyond the brief — mold: `fonts.serifBold`, the serif heading
     * family used by nearly every ported title (rules sheet, report sheet,
     * profile edit sheet, notice card). */
    serifBold: string | undefined;
    /** Added beyond the brief — mold: `fonts.serifBoldItalic`, part of the
     * same declared font contract (not yet called from a community/*.tsx
     * file, but part of the seam's public surface for future emphasis use). */
    serifBoldItalic: string | undefined;
  };
  radius: { sm: number; md: number; lg: number; pill: number };
  spacing: (n: number) => number; // default n * 4
  /** Added beyond the brief — mold: `Palette.shadow`. See `ShadowToken`. */
  shadow: ShadowToken;
};

// Neutral placeholder palette — no Eve (or any host app) branding. Hosts
// override via `CommunityUIProvider`'s `theme` prop / `mergeTheme`.
const accent = "#4C6FFF";

export const defaultTheme: CommunityTheme = {
  colors: {
    background: "#F7F7F8",
    surface: "#FFFFFF",
    surfaceMuted: "#EEEEF1",
    border: "rgba(20,20,25,0.10)",
    borderStrong: "rgba(20,20,25,0.24)",
    hairline: "rgba(20,20,25,0.08)",
    textPrimary: "#16161A",
    textSecondary: "#45454C",
    textMuted: "rgba(22,22,26,0.6)",
    textFaint: "rgba(22,22,26,0.4)",
    textInverse: "#FFFFFF",
    accent,
    accentSoft: "rgba(76,111,255,0.55)",
    danger: "#D14343",
    success: "#2E9E5B",
    // mold reuses its single accent color (`gold`) for like/official/pinned
    // indicators; default these to `accent` too, kept as separate tokens so
    // hosts can diverge them independently.
    like: accent,
    official: accent,
    pinned: accent,
  },
  fonts: {
    regular: undefined,
    medium: undefined,
    bold: undefined,
    serifBold: undefined,
    serifBoldItalic: undefined,
  },
  radius: { sm: 8, md: 16, lg: 24, pill: 9999 },
  spacing: (n: number) => n * 4,
  shadow: {
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
};

export function mergeTheme(partial: DeepPartial<CommunityTheme> = {}): CommunityTheme {
  return {
    colors: { ...defaultTheme.colors, ...partial.colors },
    fonts: { ...defaultTheme.fonts, ...partial.fonts },
    radius: { ...defaultTheme.radius, ...partial.radius },
    spacing: partial.spacing ?? defaultTheme.spacing,
    shadow: {
      ...defaultTheme.shadow,
      ...partial.shadow,
      shadowOffset: { ...defaultTheme.shadow.shadowOffset, ...partial.shadow?.shadowOffset },
    },
  };
}
