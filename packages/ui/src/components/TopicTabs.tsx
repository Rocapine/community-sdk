// The feed's topic filter: a scrollable row of tabs, after Eve's community
// header. One accent underline slides to the selected tab and takes its width;
// each label's colour follows the underline (muted → primary as it arrives),
// so switching tabs animates as one motion. Labels keep one weight, so
// selecting never changes their width. The selected tab is kept in view
// however it was chosen: a tap here, a post's topic, or a host request
// (`topicRequest`).
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useCommunityTheme, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { haptic } from "./PressableScale";

export const TABS_ROW_HEIGHT = 46;
const SLIDE = { duration: 260 };

export function TopicTabs({
  tabs,
  selected,
  onSelect,
}: {
  tabs: { id: string; label: string }[];
  selected: string;
  onSelect(id: string): void;
}) {
  const styles = useThemedStyles(makeStyles);
  const scrollRef = useRef<ScrollView>(null);
  const boxes = useRef<Record<string, { x: number; width: number }>>({});
  const rowWidth = useRef(0);
  // The underline: left edge and width of the label it sits under.
  const lineX = useSharedValue(0);
  const lineW = useSharedValue(0);
  const placed = useRef(false);

  const moveTo = (id: string) => {
    const box = boxes.current[id];
    if (!box) return;
    if (!placed.current) {
      // First placement: no slide in from the row's start.
      placed.current = true;
      lineX.value = box.x;
      lineW.value = box.width;
    } else {
      lineX.value = withTiming(box.x, SLIDE);
      lineW.value = withTiming(box.width, SLIDE);
    }
    if (rowWidth.current > 0) {
      scrollRef.current?.scrollTo({
        x: Math.max(0, box.x - (rowWidth.current - box.width) / 2),
        animated: true,
      });
    }
  };

  useEffect(() => moveTo(selected), [selected]);

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lineX.value }],
    width: lineW.value,
  }));

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      alwaysBounceVertical={false}
      directionalLockEnabled
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.row}
      onLayout={(e) => {
        rowWidth.current = e.nativeEvent.layout.width;
        moveTo(selected);
      }}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          label={tab.label}
          active={tab.id === selected}
          lineX={lineX}
          onPress={() => {
            if (tab.id === selected) return;
            haptic("selection");
            onSelect(tab.id);
          }}
          onBox={(box) => {
            boxes.current[tab.id] = box;
            // A host-selected tab may be laid out after the selection landed.
            if (tab.id === selected) moveTo(tab.id);
          }}
        />
      ))}
      <Animated.View style={[styles.line, lineStyle]} pointerEvents="none" />
    </ScrollView>
  );
}

function Tab({
  label,
  active,
  lineX,
  onPress,
  onBox,
}: {
  label: string;
  active: boolean;
  lineX: SharedValue<number>;
  onPress(): void;
  onBox(box: { x: number; width: number }): void;
}) {
  const theme = useCommunityTheme();
  const styles = useThemedStyles(makeStyles);
  // This label's own left edge and width, for the underline's distance to it.
  const x = useSharedValue(-1);
  const w = useSharedValue(1);
  const muted = theme.colors.textMuted;
  const primary = theme.colors.textPrimary;
  const labelStyle = useAnimatedStyle(() => {
    const near = x.value < 0 ? 0 : Math.max(0, 1 - Math.abs(lineX.value - x.value) / w.value);
    return { color: interpolateColor(near, [0, 1], [muted, primary]) };
  });

  return (
    <Pressable
      onPress={onPress}
      onLayout={(e) => {
        const { x: left, width } = e.nativeEvent.layout;
        // The underline spans the label, inside the tab's horizontal padding.
        const box = { x: left + TAB_PADDING, width: width - TAB_PADDING * 2 };
        x.value = box.x;
        w.value = Math.max(1, box.width);
        onBox(box);
      }}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Animated.Text style={[styles.label, labelStyle]}>{label}</Animated.Text>
    </Pressable>
  );
}

const TAB_PADDING = 12;

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    row: { paddingHorizontal: theme.spacing(1.5), height: TABS_ROW_HEIGHT },
    tab: { height: TABS_ROW_HEIGHT, paddingHorizontal: TAB_PADDING, justifyContent: "center" },
    label: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 15,
      color: theme.colors.textMuted,
    },
    line: {
      position: "absolute",
      left: 0,
      bottom: 0,
      height: 3,
      borderRadius: 2,
      backgroundColor: theme.colors.accent,
    },
  });
}
