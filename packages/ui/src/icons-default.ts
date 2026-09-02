// Default icon set for @rocapine/community-ui, built on phosphor-react-native.
//
// phosphor-react-native is now an OPTIONAL peer dependency (see this
// package's `peerDependenciesMeta`) — a host that supplies a complete
// `icons` set to `CommunityUIProvider` never needs to install it. This
// module must therefore never import phosphor-react-native at the top
// level: a static `import` would make module resolution (and therefore
// this whole package) fail to load for a host that skipped the peer.
//
// Every icon below lazy-loads phosphor inside its own render (`require`
// wrapped in try/catch, cached after the first attempt) and throws a clear,
// actionable error only when a default icon actually RENDERS without
// phosphor installed. Importing this module — or mounting `CommunityUIProvider`
// with a host `icons` set that overrides every name — never throws.
import { createElement, type ComponentType } from "react";
import type { CommunityIconName, CommunityIconProps, CommunityIconSet } from "./icons";

// Ambient `require` — this file deliberately avoids a static import of
// phosphor-react-native (see module comment above), so it needs the raw
// CommonJS `require` rather than an `import` the TS/Metro compiler would
// hoist and resolve eagerly. React Native's Metro runtime provides `require`
// globally; this declaration only satisfies the type checker.
declare function require(id: string): unknown;

type PhosphorModule = Record<string, ComponentType<CommunityIconProps>>;

// `undefined` = not attempted yet, `null` = attempted and unavailable.
let phosphorModule: PhosphorModule | null | undefined;

function loadPhosphor(): PhosphorModule | null {
  if (phosphorModule !== undefined) return phosphorModule;
  try {
    phosphorModule = require("phosphor-react-native") as PhosphorModule;
  } catch {
    phosphorModule = null;
  }
  return phosphorModule;
}

function fromPhosphor(
  iconName: CommunityIconName,
  glyphName: string,
): ComponentType<CommunityIconProps> {
  function DefaultIcon(props: CommunityIconProps) {
    const mod = loadPhosphor();
    const Glyph = mod?.[glyphName];
    if (!Glyph) {
      throw new Error(
        `@rocapine/community-ui: the default "${iconName}" icon needs phosphor-react-native ` +
          `(glyph "${glyphName}" not found) — install phosphor-react-native, or pass a ` +
          `complete \`icons\` set to CommunityUIProvider.`,
      );
    }
    return createElement(Glyph, props);
  }
  DefaultIcon.displayName = `CommunityDefaultIcon(${iconName})`;
  return DefaultIcon;
}

/** Phosphor-backed default `CommunityIconSet` — see `icons.ts` for the
 * role -> glyph mapping this mirrors. Every entry is a plain component
 * reference: constructing this object never touches phosphor (the lazy
 * `require` only runs once an icon actually renders — see `fromPhosphor`). */
export const defaultIcons: CommunityIconSet = {
  like: fromPhosphor("like", "Heart"),
  reaction: fromPhosphor("reaction", "HandHeart"),
  comment: fromPhosphor("comment", "ChatCircle"),
  menu: fromPhosphor("menu", "DotsThree"),
  back: fromPhosphor("back", "CaretLeft"),
  close: fromPhosphor("close", "X"),
  send: fromPhosphor("send", "PaperPlaneRight"),
  bell: fromPhosphor("bell", "Bell"),
  search: fromPhosphor("search", "MagnifyingGlass"),
  officialSeal: fromPhosphor("officialSeal", "SealCheck"),
  pin: fromPhosphor("pin", "PushPin"),
  announcement: fromPhosphor("announcement", "Megaphone"),
  checkmark: fromPhosphor("checkmark", "CheckCircle"),
  poll: fromPhosphor("poll", "ChartBarHorizontal"),
  add: fromPhosphor("add", "Plus"),
  warning: fromPhosphor("warning", "ShieldWarning"),
};

/** Merges a host's `icons` override over `defaultIcons` — used by
 * `CommunityUIProvider`'s `icons` prop. Pure (no React rendering, no
 * phosphor access): an unset `CommunityIconName` falls back to its
 * `defaultIcons` entry; every set name replaces its default outright. */
export function mergeIcons(overrides?: Partial<CommunityIconSet>): CommunityIconSet {
  return { ...defaultIcons, ...overrides };
}
