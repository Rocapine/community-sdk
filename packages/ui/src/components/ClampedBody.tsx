// Post / comment body: clamped to `clampLines` with a "View more" toggle, and
// laid out so switching between the original and its translation never moves
// the card. Every version is measured unclamped by an invisible copy laid out
// at the same width (iOS `onTextLayout` only reports visible lines once
// `numberOfLines` is set, so a clamped text can't tell whether it overflows);
// the visible text is clamped from its first frame and the box reserves the
// tallest version's height. Keyed list recycling remounts the card, which
// resets `expanded` (accepted).
import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { useT } from "../ThemeProvider";
import { anyOverflows, reservedHeight, type TextLine } from "../utils/clamp";

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
  const [measured, setMeasured] = useState<Record<string, TextLine[]>>({});

  const versions = alternate != null && alternate !== text ? [text, alternate] : [text];
  const lineSets = versions.map((v) => measured[v] ?? null);
  const minHeight = reservedHeight(lineSets, clampLines, expanded);

  return (
    <>
      {/* One accessibility element carrying the shown text: an accessible
          parent (the post card) builds its label from its children and stops
          at a child that has its own label, so the invisible measuring copies
          below are never read out (accessibilityElementsHidden alone does not
          stop that aggregation on iOS). */}
      <View
        style={minHeight === undefined ? undefined : { minHeight }}
        accessible
        accessibilityRole="text"
        accessibilityLabel={text}
      >
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
                const lines = e.nativeEvent.lines.map(({ y, height }) => ({ y, height }));
                setMeasured((m) => (m[v]?.length === lines.length ? m : { ...m, [v]: lines }));
              }}
            >
              {v}
            </Text>
          ))}
        </View>
      </View>
      {anyOverflows(lineSets, clampLines) && (
        <Pressable hitSlop={8} onPress={() => setExpanded((e) => !e)}>
          <Text style={viewMoreStyle}>{expanded ? t("post.viewLess") : t("post.viewMore")}</Text>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  measure: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },
  measureText: { position: "absolute", top: 0, left: 0, right: 0 },
});
