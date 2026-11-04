// A member's badges (badges module): next to the author on posts and comments, as
// stats on the profile. A host draws them through `CommunityUIProvider`'s
// `renderMemberBadge`; without it, the built-in streak badges (`streak`,
// `bestStreak`) are pills and any other badge shows nothing.
import {
  streakDays,
  useCommunityConfig,
  type BadgePlacement,
  type MemberBadgeData,
  type MemberBadges,
} from "@rocapine/community-core";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useMemberBadgeRenderer } from "../ThemeProvider";
import { badgesFor } from "../utils/badges";
import { StreakPill } from "./StreakPill";

export type MemberBadgeRenderProps = {
  /** The badge's id, as the app declared it in `modules.badges`. */
  id: string;
  /** The badge's data, as the app wrote it (`host.getBadges`). */
  data: MemberBadgeData;
  placement: BadgePlacement;
  /** `small` next to a name, `large` on the profile. */
  size: "small" | "large";
};

/** The built-in look: the two streak badges as pills, nothing for other ids or under
 * one day. */
export function defaultMemberBadge({ id, data, size }: MemberBadgeRenderProps): ReactNode {
  const days =
    id === "streak" && typeof data.since === "string"
      ? streakDays(data.since)
      : id === "bestStreak" && typeof data.days === "number"
        ? data.days
        : 0;
  return days >= 1 ? <StreakPill days={days} size={size} /> : null;
}

/** The host's renderer, else the built-in one. Call it as a function: a badge that
 * draws nothing returns null, so callers can drop its label too. */
export function useRenderMemberBadge(): (p: MemberBadgeRenderProps) => ReactNode {
  return useMemberBadgeRenderer() ?? defaultMemberBadge;
}

/** The member's badges for one placement, in a row. Nothing when none shows. */
export function MemberBadgeRow({
  badges,
  placement,
  onPress,
  style,
}: {
  badges: MemberBadges;
  placement: "post" | "comment";
  /** E.g. open the author's profile. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}): ReactElement | null {
  const cfg = useCommunityConfig();
  const render = useRenderMemberBadge();
  const nodes = badgesFor(placement, cfg.modules.badges, badges)
    .map(({ key, data }) => ({ key, node: render({ id: key, data, placement, size: "small" }) }))
    .filter(({ node }) => node != null);
  if (nodes.length === 0) return null;
  return (
    <Pressable onPress={onPress} disabled={!onPress} hitSlop={4} style={[styles.row, style]}>
      {nodes.map(({ key, node }) => (
        <View key={key}>{node}</View>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
  },
});
