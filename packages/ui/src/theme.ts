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

type FontWeight = "400" | "500" | "600" | "700" | "800" | "normal" | "bold";

/** One complete text style. Components spread it, then add colour and layout. */
export type TextRole = {
  fontFamily: string | undefined;
  fontWeight: FontWeight;
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
};

/** The named text styles every component draws with:
 *  - `display` (24): a profile's name
 *  - `title` (20): the feed header's title, a notice card's title
 *  - `heading` (22): sheet titles (rules, report, profile edit)
 *  - `body` (15): post text, the composer field
 *  - `bodySmall` (14): comments, a profile's bio
 *  - `label` (15): buttons, tabs, author names
 *  - `meta` (13): handle · time, counts, inbox excerpts
 *  - `caption` (12): helpers, pills, small print
 *  - `input` (16): text fields (16 keeps iOS Safari from zooming in on focus) */
export type TextRoleName =
  "display" | "title" | "heading" | "body" | "bodySmall" | "label" | "meta" | "caption" | "input";

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
    /** Active state of the secondary reaction (icon tint and count). Defaults
     * to `accent`. */
    reaction: string;
    admin: string;
    /** An admin account's name on posts, comments and its profile. Defaults to
     * `textPrimary`. */
    adminName: string;
    pinned: string;
    /** The feed's top bar: its title and icons, and the selected topic tab. Defaults
     * to `textPrimary`; set it (and `headerTextMuted`) for a bar whose background
     * calls for another color, e.g. light text over a dark header image. */
    headerText: string;
    /** The unselected topic tabs. Defaults to `textMuted`. */
    headerTextMuted: string;
    /** Streak pills by tier (streaks module): under 30 days, 30 to 90, beyond
     * 90. The pill's text and icon take the color, its fill a tint of it. */
    streakBronze: string;
    streakSilver: string;
    streakGold: string;
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
  /** Weight paired with each `fonts` family. A host loading one family with
   * several weights (expo-font `fontDefinitions`) gets real bold text this
   * way; a host passing one file per weight can leave the defaults. */
  fontWeights: {
    regular: FontWeight;
    medium: FontWeight;
    bold: FontWeight;
  };
  /** Derived from `fonts` and `fontWeights` unless overridden, role by role and field
   * by field (`typography: { title: { fontFamily: "Orbitron" } }`). */
  typography: Record<TextRoleName, TextRole>;
  /** The only four corner radii the package uses. Nested surfaces follow the
   * concentric rule: inner radius = outer radius − the padding between them
   * (a `lg` card with `spacing(4)` padding holds `sm` children). */
  radius: { sm: number; md: number; lg: number; pill: number };
  spacing: (n: number) => number; // default n * 4
  /** Added beyond the brief — mold: `Palette.shadow`. See `ShadowToken`. */
  shadow: ShadowToken;
};

/** Each role's size, family slot and weight slot. */
const ROLES: Record<
  TextRoleName,
  [number, keyof CommunityTheme["fonts"], keyof CommunityTheme["fontWeights"]]
> = {
  display: [24, "serifBold", "bold"],
  title: [20, "serifBold", "bold"],
  heading: [22, "serifBold", "bold"],
  body: [15, "regular", "regular"],
  bodySmall: [14, "regular", "regular"],
  label: [15, "medium", "medium"],
  meta: [13, "regular", "regular"],
  caption: [12, "regular", "regular"],
  input: [16, "regular", "regular"],
};

function deriveTypography(
  fonts: CommunityTheme["fonts"],
  fontWeights: CommunityTheme["fontWeights"],
  partial: DeepPartial<CommunityTheme["typography"]> = {},
): CommunityTheme["typography"] {
  const out = {} as CommunityTheme["typography"];
  for (const name of Object.keys(ROLES) as TextRoleName[]) {
    const [fontSize, family, weight] = ROLES[name];
    out[name] = {
      fontFamily: fonts[family],
      fontWeight: fontWeights[weight],
      fontSize,
      ...(partial[name] as Partial<TextRole> | undefined),
    };
  }
  return out;
}

// Neutral placeholder palette — no Eve (or any host app) branding. Hosts
// override via `CommunityUIProvider`'s `theme` prop / `mergeTheme`.
const accent = "#4C6FFF";

const DEFAULT_FONTS: CommunityTheme["fonts"] = {
  regular: undefined,
  medium: undefined,
  bold: undefined,
  serifBold: undefined,
  serifBoldItalic: undefined,
};
const DEFAULT_FONT_WEIGHTS: CommunityTheme["fontWeights"] = {
  regular: "400",
  medium: "500",
  bold: "600",
};

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
    // mold reuses its single accent color (`gold`) for like/admin/pinned
    // indicators; default these to `accent` too, kept as separate tokens so
    // hosts can diverge them independently.
    like: accent,
    reaction: accent,
    admin: accent,
    adminName: "#16161A",
    pinned: accent,
    headerText: "#16161A",
    headerTextMuted: "rgba(22,22,26,0.6)",
    streakBronze: "#B0703A",
    streakSilver: "#7D8794",
    streakGold: "#C9930A",
  },
  fonts: DEFAULT_FONTS,
  fontWeights: DEFAULT_FONT_WEIGHTS,
  typography: deriveTypography(DEFAULT_FONTS, DEFAULT_FONT_WEIGHTS),
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
  const fonts = { ...defaultTheme.fonts, ...partial.fonts };
  const fontWeights = { ...defaultTheme.fontWeights, ...partial.fontWeights };
  return {
    colors: {
      ...defaultTheme.colors,
      ...partial.colors,
      adminName:
        partial.colors?.adminName ?? partial.colors?.textPrimary ?? defaultTheme.colors.adminName,
      headerText:
        partial.colors?.headerText ?? partial.colors?.textPrimary ?? defaultTheme.colors.headerText,
      headerTextMuted:
        partial.colors?.headerTextMuted ??
        partial.colors?.textMuted ??
        defaultTheme.colors.headerTextMuted,
    },
    fonts,
    fontWeights,
    typography: deriveTypography(fonts, fontWeights, partial.typography),
    radius: { ...defaultTheme.radius, ...partial.radius },
    spacing: partial.spacing ?? defaultTheme.spacing,
    shadow: {
      ...defaultTheme.shadow,
      ...partial.shadow,
      shadowOffset: { ...defaultTheme.shadow.shadowOffset, ...partial.shadow?.shadowOffset },
    },
  };
}
