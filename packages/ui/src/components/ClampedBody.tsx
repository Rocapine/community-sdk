// Post / comment body: clamped to `clampLines` with a "View more" toggle, and
// laid out so switching between the original and its translation never moves
// the card. Every version is measured unclamped by an invisible copy laid out
// at the same width (iOS `onTextLayout` only reports visible lines once
// `numberOfLines` is set, so a clamped text can't tell whether it overflows);
// the visible text is clamped from its first frame and the box reserves the
// tallest version's height. Keyed list recycling remounts the card, which
// resets `expanded` (accepted).
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useT } from "../ThemeProvider";
import { anyOverflows, reservedHeight, type TextLine } from "../utils/clamp";

export function ClampedBody({
  text,
  alternate,
  clampLines,
  textStyle,
  viewMoreStyle,
  style,
}: {
  /** The version shown. */
  text: string;
  /** The other version (original or translation) the reader can switch to, if any. */
  alternate?: string | null;
  clampLines: number;
  textStyle: StyleProp<TextStyle>;
  /** Omit for a plain clamped label (poll options): no "View more" toggle. */
  viewMoreStyle?: StyleProp<TextStyle>;
  /** Style of the box holding the text (e.g. `flex: 1` inside a row). */
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [measured, setMeasured] = useState<Record<string, TextLine[]>>({});

  const versions = alternate != null && alternate !== text ? [text, alternate] : [text];
  const lineSets = versions.map((v) => measured[v] ?? null);
  const minHeight = reservedHeight(lineSets, clampLines, expanded);
  const shownOverflows = anyOverflows([lineSets[0]], clampLines);

  return (
    <>
      {/* One accessibility element carrying the shown text: an accessible
          parent (the post card) builds its label from its children and stops
          at a child that has its own label, so the invisible measuring copies
          below are never read out (accessibilityElementsHidden alone does not
          stop that aggregation on iOS). */}
      <View
        style={[style, minHeight === undefined ? undefined : { minHeight }]}
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
      {/* Offered when the shown version overflows. When only the other
          version does, the link keeps its space (so switching versions never
          moves the layout) but stays invisible and inert. */}
      {viewMoreStyle !== undefined && anyOverflows(lineSets, clampLines) && (
        <Pressable
          hitSlop={8}
          disabled={!shownOverflows}
          accessibilityElementsHidden={!shownOverflows}
          importantForAccessibility={shownOverflows ? "auto" : "no-hide-descendants"}
          style={shownOverflows ? undefined : styles.hidden}
          onPress={() => setExpanded((e) => !e)}
        >
          <Text style={viewMoreStyle}>{expanded ? t("post.viewLess") : t("post.viewMore")}</Text>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  measure: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },
  measureText: { position: "absolute", top: 0, left: 0, right: 0 },
});
