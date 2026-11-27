// The day between two runs of messages: "Today", "Yesterday", the weekday within the
// week, else the short date (see `dayLabel`).
import { useCommunityConfig } from "@rocapine/community-core";
import { StyleSheet, Text } from "react-native";
import { useT, useThemedStyles } from "../../ThemeProvider";
import type { CommunityTheme } from "../../theme";
import { dayLabel } from "../../utils/chat";

/** `day` and `today`: local days, `YYYY-MM-DD`. */
export function DaySeparator({ day, today }: { day: string; today: string }) {
  const t = useT();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);
  return (
    <Text style={styles.day} accessibilityRole="header">
      {dayLabel(day, today, cfg.host.getLocale(), t)}
    </Text>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    day: {
      ...theme.typography.caption,
      color: theme.colors.textMuted,
      textAlign: "center",
      marginVertical: theme.spacing(3),
    },
  });
}
