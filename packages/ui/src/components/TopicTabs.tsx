// The feed's topic filter: a scrollable row of tabs (label + accent underline
// on the selected one), after Eve's community header. The selected tab is
// kept in view however it was chosen: a tap here, a post's topic, or a host
// request (`topicRequest`).
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { haptic } from "./PressableScale";

export const TABS_ROW_HEIGHT = 46;

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

  const center = (id: string, animated: boolean) => {
    const box = boxes.current[id];
    if (!box) return;
    scrollRef.current?.scrollTo({
      x: Math.max(0, box.x - (rowWidth.current - box.width) / 2),
      animated,
    });
  };

  useEffect(() => center(selected, true), [selected]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      onLayout={(e) => (rowWidth.current = e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.id === selected;
        return (
          <Pressable
            key={tab.id}
            onPress={() => {
              if (active) return;
              haptic("selection");
              onSelect(tab.id);
            }}
            onLayout={(e) => {
              boxes.current[tab.id] = e.nativeEvent.layout;
              // A host-selected tab may be laid out after the selection landed.
              if (active) center(tab.id, false);
            }}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
            <View style={[styles.line, active && styles.lineActive]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    row: { paddingHorizontal: theme.spacing(1.5), height: TABS_ROW_HEIGHT },
    tab: { height: TABS_ROW_HEIGHT, paddingHorizontal: theme.spacing(3), justifyContent: "center" },
    label: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 15,
      color: theme.colors.textMuted,
    },
    labelActive: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textPrimary,
    },
    line: {
      position: "absolute",
      left: theme.spacing(3),
      right: theme.spacing(3),
      bottom: 0,
      height: 3,
      borderRadius: 2,
    },
    lineActive: { backgroundColor: theme.colors.accent },
  });
}
