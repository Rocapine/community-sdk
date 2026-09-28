// Post / comment body: clamped to `clampLines` with a "View more" toggle,
// inside an `AnimatedHeight` so switching between the original and its
// translation (or expanding) animates the card's height instead of jumping.
//
// The visible text is clamped from its first frame; every version is measured
// unclamped by an invisible copy at the same width (iOS `onTextLayout` only
// reports visible lines once `numberOfLines` is set, so a clamped text can't
// tell whether it overflows). Measuring the other version up front means the
// "View more" link of the version switched to is known in the same commit as
// the switch, so the whole change animates as one. Keyed list recycling
// remounts the card, which resets `expanded` (accepted).
import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { useT } from "../ThemeProvider";
import { AnimatedHeight } from "./AnimatedHeight";

export function ClampedBody({
  text,
  alternate,
  clampLines,
  textStyle,
  viewMoreStyle,
}: {
  /** The version shown. */
  text: string;
  /** The other version (original or translation) the reader can switch to, if any. */
  alternate?: string | null;
  clampLines: number;
  textStyle: StyleProp<TextStyle>;
  viewMoreStyle: StyleProp<TextStyle>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [lineCounts, setLineCounts] = useState<Record<string, number>>({});

  const versions = alternate != null && alternate !== text ? [text, alternate] : [text];
  const overflows = (lineCounts[text] ?? 0) > clampLines;

  return (
    <AnimatedHeight>
      {/* One accessibility element carrying the shown text: an accessible
          parent (the post card) builds its label from its children and stops
          at a child that has its own label, so the invisible measuring copies
          below are never read out (accessibilityElementsHidden alone does not
          stop that aggregation on iOS). */}
      <View accessible accessibilityRole="text" accessibilityLabel={text}>
        <Text style={textStyle} numberOfLines={expanded ? undefined : clampLines}>
          {text}
        </Text>
        <View
          style={styles.measure}
          pointerEvents="none"
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {versions.map((v) => (
            <Text
              key={v}
              style={[textStyle, styles.measureText]}
              onTextLayout={(e) => {
                const count = e.nativeEvent.lines.length;
                setLineCounts((m) => (m[v] === count ? m : { ...m, [v]: count }));
              }}
            >
              {v}
            </Text>
          ))}
        </View>
      </View>
      {overflows && (
        <Pressable hitSlop={8} onPress={() => setExpanded((e) => !e)}>
          <Text style={viewMoreStyle}>{expanded ? t("post.viewLess") : t("post.viewMore")}</Text>
        </Pressable>
      )}
    </AnimatedHeight>
  );
}

const styles = StyleSheet.create({
  measure: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },
  measureText: { position: "absolute", top: 0, left: 0, right: 0 },
});
