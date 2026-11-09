// The feed header's configuration, and which items each zone actually shows.
// Pure (type-only React Native import) so it is unit-testable.
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
      /** Defaults to 28. */
      height?: number;
      /** Defaults to `height` (a square mark). */
      width?: number;
      accessibilityLabel?: string;
    };

/** Painted behind the feed's top bar, from the top of the screen down to the topic
 * tabs. `extendTop`: how far above the bar it reaches, e.g. the status bar's height
 * when the host pads the screen's top inset itself. */
export type FeedHeaderBackground = {
  image?: ImageProps["source"];
  color?: string;
  contentFit?: "cover" | "contain";
  extendTop?: number;
};

/** The feed's header: three zones, each a row of items. `center` stays centred
 * whatever the side zones hold. A zone left out is empty. */
export type FeedHeaderConfig = {
  left?: FeedHeaderItem[];
  center?: FeedHeaderItem[];
  right?: FeedHeaderItem[];
  background?: FeedHeaderBackground;
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
  const keep = (items: FeedHeaderItem[] = []) =>
    items.filter((item) => item !== "inbox" || opts.inbox);
  const left = keep(config.left);
  const center = keep(config.center);
  const right = keep(config.right);
  return { left, center, right, visible: left.length + center.length + right.length > 0 };
}
