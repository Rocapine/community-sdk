// Injectable icon contract for @rocapine/community-ui.
//
// This file defines the icon surface every component in this package needs as
// a finite, ROLE-named union: a host supplying its own set names each entry by
// what it MEANS here (`like`, `menu`, `back`, ...), never by a glyph name. See
// `icons-default.ts` for the expo-symbols default (SF Symbols / Material
// Symbols) and `ThemeProvider.tsx` for how a host overrides part or all of
// this set via `CommunityUIProvider`'s `icons` prop.
import type { ComponentType } from "react";

/** The three weights every icon call site in this package passes. */
export type CommunityIconWeight = "regular" | "fill" | "bold";

/** Prop shape every icon component in a `CommunityIconSet` must accept
 * (`size`, `color`, `weight`): any icon library can be adapted with these three. */
export type CommunityIconProps = {
  size?: number;
  color?: string;
  weight?: CommunityIconWeight;
};

/**
 * Every icon role this package renders, named by ROLE not by glyph:
 *  - `like`          — post like button / like notification
 *  - `reaction`       — the generic secondary "reaction" button / notification
 *  - `comment`        — comment count stat / comment notification
 *  - `menu`           — post/comment/profile overflow menu
 *  - `back`           — profile screen back button
 *  - `close`          — composer/search dismiss
 *  - `send`           — thread comment composer submit
 *  - `bell`           — feed header notifications entry point
 *  - `search`         — feed search toggle/input
 *  - `officialSeal`   — official-account badge on a post/comment/profile
 *  - `pin`            — pinned-post indicator
 *  - `announcement`   — official-post notification row
 *  - `checkmark`      — selected poll option
 *  - `poll`           — composer poll toggle
 *  - `add`            — composer "add poll option"
 *  - `warning`        — notice card (moderation/network error)
 *  - `compose`        — floating "write a post" bar shown once the composer scrolls away
 *  - `image`          — composer "add an image" button (images module)
 *  - `reply`          — reply to a comment (thread)
 */
export type CommunityIconName =
  | "like"
  | "reaction"
  | "comment"
  | "menu"
  | "back"
  | "close"
  | "send"
  | "bell"
  | "search"
  | "officialSeal"
  | "pin"
  | "announcement"
  | "checkmark"
  | "poll"
  | "add"
  | "warning"
  | "compose"
  | "image"
  | "reply";

export type CommunityIconSet = Record<CommunityIconName, ComponentType<CommunityIconProps>>;
