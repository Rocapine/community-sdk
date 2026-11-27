// The day between two runs of messages: "Today", "Yesterday", or the date.
import { useCommunityConfig } from "@rocapine/community-core";
import { StyleSheet, Text } from "react-native";
import { useT, useThemedStyles } from "../../ThemeProvider";
import type { CommunityTheme } from "../../theme";

/** `day`: a `groupByDay` label ("today", "yesterday" or `YYYY-MM-DD`). */
export function DaySeparator({ day }: { day: string }) {
  const t = useT();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);
  let label = day;
  if (day === "today" || day === "yesterday") label = t(`chat.${day}`);
  else {
    const [y, m, d] = day.split("-").map(Number);
    const date = new Date(y!, m! - 1, d!);
    const sameYear = y === new Date().getFullYear();
    try {
      label = date.toLocaleDateString(cfg.host.getLocale(), {
        day: "numeric",
        month: "long",
        ...(sameYear ? {} : { year: "numeric" }),
      });
    } catch {
      // An invalid host locale: the ISO date still reads.
    }
  }
  return (
    <Text style={styles.day} accessibilityRole="header">
      {label}
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
