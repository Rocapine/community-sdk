// Injectable icon contract for @rocapine/community-ui.
//
// Not every host uses phosphor-react-native (the package's original hard
// icon dependency). This file defines the icon surface every component in
// this package actually needs — enumerated from the phosphor imports the
// components used to have — as a finite, ROLE-named union: a host supplying
// its own set names each entry by what it MEANS here (`like`, `menu`,
// `back`, ...), never by the glyph phosphor happens to default to
// (`Heart`, `DotsThree`, `CaretLeft`, ...). See `icons-default.ts` for the
// phosphor-backed default implementation and `ThemeProvider.tsx` for how a
// host overrides part or all of this set via `CommunityUIProvider`'s
// `icons` prop.
import type { ComponentType } from "react";

/** The three phosphor-style weights every icon call site in this package
 * actually passes — matches phosphor-react-native's own `IconWeight`
 * (narrowed to the subset this package uses: no "thin"/"light"/"duotone"). */
export type CommunityIconWeight = "regular" | "fill" | "bold";

/** Prop shape every icon component in a `CommunityIconSet` must accept —
 * exactly the phosphor-react-native props this package's components pass
 * at their call sites (`size`, `color`, `weight`), so a drop-in replacement
 * for any other icon library only needs to accept these three. */
export type CommunityIconProps = {
  size?: number;
  color?: string;
  weight?: CommunityIconWeight;
};

/**
 * Every icon role this package renders, named by ROLE not by glyph.
 * Enumerated from every `phosphor-react-native` import across
 * `packages/ui/src`:
 *  - `like`          — post like button / like notification (phosphor: Heart)
 *  - `reaction`       — the generic secondary "reaction" button / notification (phosphor: HandHeart)
 *  - `comment`        — comment count stat / comment notification (phosphor: ChatCircle)
 *  - `menu`           — post/comment/profile overflow menu (phosphor: DotsThree)
 *  - `back`           — profile screen back button (phosphor: CaretLeft)
 *  - `close`          — composer/search dismiss (phosphor: X)
 *  - `send`           — thread comment composer submit (phosphor: PaperPlaneRight)
 *  - `bell`           — feed header notifications entry point (phosphor: Bell)
 *  - `search`         — feed search toggle/input (phosphor: MagnifyingGlass)
 *  - `officialSeal`   — official-account badge on a post/comment/profile (phosphor: SealCheck)
 *  - `pin`            — pinned-post indicator (phosphor: PushPin)
 *  - `announcement`   — official-post notification row (phosphor: Megaphone)
 *  - `checkmark`      — selected poll option (phosphor: CheckCircle)
 *  - `poll`           — composer poll toggle (phosphor: ChartBarHorizontal)
 *  - `add`            — composer "add poll option" (phosphor: Plus)
 *  - `warning`        — notice card (moderation/network error) (phosphor: ShieldWarning)
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
  | "warning";

export type CommunityIconSet = Record<CommunityIconName, ComponentType<CommunityIconProps>>;
