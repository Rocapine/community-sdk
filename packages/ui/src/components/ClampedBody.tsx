// Post / comment body: clamped to `clampLines` with a "View more" link at the
// end of the last visible line (`…text… View more`), inside an
// `AnimatedHeight` so switching between the original and its translation (or
// expanding) animates the row's height instead of jumping. Expanded stays
// expanded (no "View less"), as on X.
//
// Every version is measured unclamped by an invisible copy at the same width
// (iOS `onTextLayout` only reports visible lines once `numberOfLines` is set),
// and so is the link, so `clampWithSuffix` can cut the last visible line
// where the link fits. Measuring the other version up front means the cut of
// the version switched to is known in the same commit as the switch, so the
// whole change animates as one. Until the measures land, the text is clamped
// by `numberOfLines`. Keyed list recycling remounts the row, which resets
// `expanded` (accepted).
import { useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { useT } from "../ThemeProvider";
import { clampWithSuffix } from "../utils/clamp";
import { AnimatedHeight } from "./AnimatedHeight";

type Line = { text: string; width: number };

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
  const [layouts, setLayouts] = useState<Record<string, Line[]>>({});
  const [width, setWidth] = useState(0);
  const [suffixWidth, setSuffixWidth] = useState(0);

  const versions = alternate != null && alternate !== text ? [text, alternate] : [text];
  const lines = layouts[text];
  const measured = lines !== undefined && width > 0 && suffixWidth > 0;
  const clamped =
    !expanded && measured ? clampWithSuffix(lines, clampLines, width, suffixWidth) : null;
  const viewMore = t("post.viewMore");

  return (
    <AnimatedHeight>
      {/* One accessibility element carrying the shown text: an accessible
          parent (the post row) builds its label from its children and stops
          at a child that has its own label, so the invisible measuring copies
          below are never read out (accessibilityElementsHidden alone does not
          stop that aggregation on iOS). The inline link is offered as its
          activate action. */}
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={text}
        accessibilityActions={clamped !== null ? [{ name: "activate", label: viewMore }] : []}
        onAccessibilityAction={() => setExpanded(true)}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {clamped !== null ? (
          <Text style={textStyle}>
            {clamped}{" "}
            <Text style={viewMoreStyle} onPress={() => setExpanded(true)} suppressHighlighting>
              {viewMore}
            </Text>
          </Text>
        ) : (
          <Text style={textStyle} numberOfLines={expanded || measured ? undefined : clampLines}>
            {text}
          </Text>
        )}
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
                const next = e.nativeEvent.lines.map((l) => ({ text: l.text, width: l.width }));
                setLayouts((m) => (sameLines(m[v], next) ? m : { ...m, [v]: next }));
              }}
            >
              {v}
            </Text>
          ))}
          <Text
            style={[textStyle, styles.measureSuffix]}
            onTextLayout={(e) => {
              const w = e.nativeEvent.lines[0]?.width ?? 0;
              setSuffixWidth((prev) => (prev === w ? prev : w));
            }}
          >
            {" "}
            <Text style={viewMoreStyle}>{viewMore}</Text>
          </Text>
        </View>
      </View>
    </AnimatedHeight>
  );
}

function sameLines(a: Line[] | undefined, b: Line[]): boolean {
  return (
    a !== undefined &&
    a.length === b.length &&
    a.every((l, i) => l.text === b[i].text && l.width === b[i].width)
  );
}

const styles = StyleSheet.create({
  measure: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },
  measureText: { position: "absolute", top: 0, left: 0, right: 0 },
  // Its natural width: the link's text, unwrapped.
  measureSuffix: { position: "absolute", top: 0, left: 0, alignSelf: "flex-start" },
});
