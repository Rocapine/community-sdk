// A full-width two-way selector ("Feed | Groups" on the community home, "Conversations |
// Groups" on the Messages page): the selected side filled with the accent, each side
// with an optional unread count.
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { haptic } from "./PressableScale";

// 34pt tall: the hit slop takes the target to 44pt.
const SEGMENT_HEIGHT = 34;
const COUNT_SIZE = 18;

export function SegmentedTabs<K extends string>({
  items,
  selected,
  onSelect,
  style,
}: {
  items: { key: K; label: string; count: number }[];
  selected: K;
  onSelect(key: K): void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.segments, style]} accessibilityRole="tablist">
      {items.map(({ key, label, count }) => {
        const on = selected === key;
        return (
          <Pressable
            key={key}
            onPress={() => {
              if (on) return;
              haptic("selection");
              onSelect(key);
            }}
            style={[styles.segment, on && styles.segmentOn]}
            hitSlop={{ top: 5, bottom: 5 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={count > 0 ? `${label}, ${t("messages.unread", { count })}` : label}
          >
            <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]} numberOfLines={1}>
              {label}
            </Text>
            {count > 0 && (
              <View style={[styles.segmentCount, on && styles.segmentCountOn]}>
                <Text style={[styles.segmentCountText, on && styles.segmentCountTextOn]}>
                  {count > 99 ? "99+" : count}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    segments: {
      flexDirection: "row",
      padding: theme.spacing(0.75),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    segment: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing(1.5),
      minHeight: SEGMENT_HEIGHT,
      borderRadius: theme.radius.sm,
    },
    segmentOn: { backgroundColor: theme.colors.accent },
    segmentLabel: { ...theme.typography.label, color: theme.colors.textMuted },
    segmentLabelOn: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textInverse,
    },
    segmentCount: {
      minWidth: COUNT_SIZE,
      height: COUNT_SIZE,
      borderRadius: COUNT_SIZE / 2,
      paddingHorizontal: theme.spacing(1.25),
      backgroundColor: theme.colors.danger,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentCountOn: { backgroundColor: theme.colors.textInverse },
    segmentCountText: {
      ...theme.typography.caption,
      fontSize: 10,
      lineHeight: 12,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textInverse,
    },
    segmentCountTextOn: { color: theme.colors.accent },
  });
}
