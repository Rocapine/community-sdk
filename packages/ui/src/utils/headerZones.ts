// The feed header's configuration, and which items each zone actually shows.
// Pure (type-only expo-image import) so it is unit-testable.
import type { ImageProps } from "expo-image";

/** One thing the header row can show:
 *  - `title`: the community's name (the `title` translation key)
 *  - `profile`: the user's avatar, opening their own profile
 *  - `search`: opens the search bar
 *  - `inbox`: the notification bell (only with the inbox module and `onOpenInbox`)
 *  - `{ logo }`: an image, e.g. the app's logo (pass the source matching your theme) */
export type FeedHeaderItem =
  | "title"
  | "profile"
  | "search"
  | "inbox"
  | {
      logo: ImageProps["source"];
      /** Defaults to 32. */
      height?: number;
      /** Defaults to `height` (a square mark). */
      width?: number;
      accessibilityLabel?: string;
    };

/** Painted behind the feed's top bar (header row and topic tabs, and the status bar
 * area when `topInset` is set). It moves with the bar when the bar hides on scroll. */
export type FeedHeaderBackground = {
  image?: ImageProps["source"];
  /** Under the image; defaults to `colors.background`. */
  color?: string;
  contentFit?: "cover" | "contain";
};

/** The feed's header: three zones, each a row of items. `center` stays centred
 * whatever the side zones hold. A zone left out is empty, unless the config sets no
 * zone at all: then the zones are `DEFAULT_FEED_HEADER`'s. */
export type FeedHeaderConfig = {
  left?: FeedHeaderItem[];
  center?: FeedHeaderItem[];
  right?: FeedHeaderItem[];
  /** `"community"`: the bar shows `CommunityUIProvider`'s `background`, laid out
   * for the whole screen and held still while the bar hides, so bar and feed read
   * as one image. */
  background?: FeedHeaderBackground | "community";
  /** The status bar's height (safe area top), when the feed should own that area
   * instead of the host padding it: the top bar starts under the status bar, its
   * background reaches behind it, and hiding on scroll stops there. */
  topInset?: number;
};

export const DEFAULT_FEED_HEADER: FeedHeaderConfig = {
  left: ["profile"],
  center: ["title"],
  right: ["search", "inbox"],
};

export function resolveHeaderZones(
  config: FeedHeaderConfig,
  opts: { inbox: boolean },
): { left: FeedHeaderItem[]; center: FeedHeaderItem[]; right: FeedHeaderItem[]; visible: boolean } {
  if (!config.left && !config.center && !config.right) config = { ...DEFAULT_FEED_HEADER };
  const keep = (items: FeedHeaderItem[] = []) =>
    items.filter((item) => item !== "inbox" || opts.inbox);
  const left = keep(config.left);
  const center = keep(config.center);
  const right = keep(config.right);
  return { left, center, right, visible: left.length + center.length + right.length > 0 };
}
