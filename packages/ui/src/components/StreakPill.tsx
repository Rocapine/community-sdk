// The streaks module's pill: a flame and "41 days", tinted by tier — bronze
// under 30 days, silver from 30 to 90, gold beyond (core's `streakTier`).
// Nothing for a streak under one day: no "0 days" badge next to a name. The
// built-in look of the `streak` and `bestStreak` badges (see `MemberBadge`); a host
// draws its own through `CommunityUIProvider`'s `renderMemberBadge`.
import { streakTier, type StreakTier } from "@rocapine/community-core";
import { StyleSheet, Text, View } from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";

const TIER_COLOR: Record<StreakTier, "streakBronze" | "streakSilver" | "streakGold"> = {
  bronze: "streakBronze",
  silver: "streakSilver",
  gold: "streakGold",
};

export function StreakPill({ days, size = "small" }: { days: number; size?: "small" | "large" }) {
  const t = useT();
  if (days < 1) return null;
  return <DefaultStreakPill days={days} size={size} label={t("streak.days", { count: days })} />;
}

function DefaultStreakPill({
  days,
  size,
  label,
}: {
  days: number;
  size: "small" | "large";
  label: string;
}) {
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const color = theme.colors[TIER_COLOR[streakTier(days)]];
  const large = size === "large";

  return (
    <View style={[styles.pill, large && styles.pillLarge]}>
      {/* The tint: the tier color at low opacity, whatever format the host gave it. */}
      <View style={[StyleSheet.absoluteFill, styles.tint, { backgroundColor: color }]} />
      <icons.streak size={large ? 14 : 11} color={color} weight="fill" />
      <Text style={[styles.label, large && styles.labelLarge, { color }]}>{label}</Text>
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 3,
      paddingHorizontal: 7,
      height: 20,
      borderRadius: theme.radius.pill,
      overflow: "hidden",
    },
    pillLarge: { height: 28, paddingHorizontal: 11, gap: 5 },
    tint: { opacity: 0.16 },
    label: {
      ...theme.typography.caption,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
    },
    labelLarge: { fontSize: theme.typography.bodySmall.fontSize },
  });
}
