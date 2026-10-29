// Default icon set for @rocapine/community-ui, built on expo-symbols: SF Symbols
// on iOS, Material Symbols on Android and web — the platform's own glyphs, so a
// host that supplies no `icons` gets a native look instead of a foreign pack.
//
// expo-symbols is an OPTIONAL peer (see `peerDependenciesMeta`): a host that
// passes a complete `icons` set never needs it. This module therefore never
// imports it at the top level — each default icon lazy-`require`s it on first
// render and throws an actionable error only then.
import { createElement, type ComponentType } from "react";
import type {
  CommunityIconName,
  CommunityIconProps,
  CommunityIconSet,
  CommunityIconWeight,
} from "./icons";

// Ambient `require`: a static import would make this whole package fail to
// load for a host that skipped the optional peer.
declare function require(id: string): unknown;

type SymbolViewProps = {
  name: { ios: string; android: string; web: string };
  size?: number;
  tintColor?: string;
  weight?: "regular" | "bold";
};
type ExpoSymbolsModule = { SymbolView: ComponentType<SymbolViewProps> };

// `undefined` = not attempted yet, `null` = attempted and unavailable.
let symbolsModule: ExpoSymbolsModule | null | undefined;

function loadExpoSymbols(): ExpoSymbolsModule | null {
  if (symbolsModule !== undefined) return symbolsModule;
  try {
    symbolsModule = require("expo-symbols") as ExpoSymbolsModule;
  } catch {
    symbolsModule = null;
  }
  return symbolsModule;
}

type Glyph = { ios: string; iosFill?: string; material: string };

function fromSymbols(iconName: CommunityIconName, glyph: Glyph): ComponentType<CommunityIconProps> {
  function DefaultIcon({ size = 20, color, weight = "regular" }: CommunityIconProps) {
    const mod = loadExpoSymbols();
    if (!mod) {
      throw new Error(
        `@rocapine/community-ui: the default "${iconName}" icon needs expo-symbols — ` +
          "run `npx expo install expo-symbols`, or pass a complete `icons` set to CommunityUIProvider.",
      );
    }
    const ios = weight === "fill" ? (glyph.iosFill ?? glyph.ios) : glyph.ios;
    return createElement(mod.SymbolView, {
      name: { ios, android: glyph.material, web: glyph.material },
      size,
      tintColor: color,
      weight: weightFor(weight),
    });
  }
  DefaultIcon.displayName = `CommunityDefaultIcon(${iconName})`;
  return DefaultIcon;
}

function weightFor(weight: CommunityIconWeight): "regular" | "bold" {
  return weight === "bold" ? "bold" : "regular";
}

/** expo-symbols-backed default `CommunityIconSet` (SF Symbol / Material Symbol per role).
 * Constructing this object never touches expo-symbols: the lazy `require` runs on render. */
export const defaultIcons: CommunityIconSet = {
  like: fromSymbols("like", { ios: "heart", iosFill: "heart.fill", material: "favorite" }),
  reaction: fromSymbols("reaction", {
    ios: "hands.and.sparkles",
    iosFill: "hands.and.sparkles.fill",
    material: "volunteer_activism",
  }),
  comment: fromSymbols("comment", {
    ios: "bubble.right",
    iosFill: "bubble.right.fill",
    material: "chat_bubble",
  }),
  reply: fromSymbols("reply", {
    ios: "arrowshape.turn.up.left",
    iosFill: "arrowshape.turn.up.left.fill",
    material: "reply",
  }),
  menu: fromSymbols("menu", { ios: "ellipsis", material: "more_horiz" }),
  back: fromSymbols("back", { ios: "chevron.left", material: "arrow_back" }),
  close: fromSymbols("close", { ios: "xmark", material: "close" }),
  send: fromSymbols("send", { ios: "paperplane", iosFill: "paperplane.fill", material: "send" }),
  bell: fromSymbols("bell", { ios: "bell", iosFill: "bell.fill", material: "notifications" }),
  search: fromSymbols("search", { ios: "magnifyingglass", material: "search" }),
  officialSeal: fromSymbols("officialSeal", {
    ios: "checkmark.seal.fill",
    iosFill: "checkmark.seal.fill",
    material: "verified",
  }),
  pin: fromSymbols("pin", { ios: "pin", iosFill: "pin.fill", material: "push_pin" }),
  announcement: fromSymbols("announcement", {
    ios: "megaphone",
    iosFill: "megaphone.fill",
    material: "campaign",
  }),
  checkmark: fromSymbols("checkmark", {
    ios: "checkmark.circle",
    iosFill: "checkmark.circle.fill",
    material: "check_circle",
  }),
  poll: fromSymbols("poll", { ios: "chart.bar.xaxis", material: "bar_chart" }),
  add: fromSymbols("add", { ios: "plus", material: "add" }),
  warning: fromSymbols("warning", {
    ios: "exclamationmark.shield",
    iosFill: "exclamationmark.shield.fill",
    material: "gpp_maybe",
  }),
  compose: fromSymbols("compose", { ios: "pencil", material: "edit" }),
  image: fromSymbols("image", { ios: "photo", material: "image" }),
};

/** Merges a host's `icons` override over `defaultIcons` — used by
 * `CommunityUIProvider`'s `icons` prop. Pure: an unset `CommunityIconName` falls
 * back to its default entry; every set name replaces its default outright. */
export function mergeIcons(overrides?: Partial<CommunityIconSet>): CommunityIconSet {
  return { ...defaultIcons, ...overrides };
}
