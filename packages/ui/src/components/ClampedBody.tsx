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
//
// react-native-web has no `onTextLayout`: on the web the lines are read off
// the measuring copies' DOM (`webLines`) each time they lay out, and the cut
// is the same as on native.
import { useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { useT } from "../ThemeProvider";
import { clampWithSuffix } from "../utils/clamp";
import { AnimatedHeight } from "./AnimatedHeight";

type Line = { text: string; width: number; charEnds?: number[] };

export function ClampedBody({
  text,
  alternate,
  clampLines,
  textStyle,
  viewMoreStyle,
  renderText,
}: {
  /** The version shown. */
  text: string;
  /** The other version (original or translation) the reader can switch to, if any. */
  alternate?: string | null;
  clampLines: number;
  textStyle: StyleProp<TextStyle>;
  viewMoreStyle: StyleProp<TextStyle>;
  /** Renders the shown text's content (e.g. highlighted mentions) inside the
   * body's own `Text`; plain text without it. */
  renderText?: (text: string) => ReactNode;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [layouts, setLayouts] = useState<Record<string, Line[]>>({});
  const setLines = (v: string, next: Line[]) =>
    setLayouts((m) => (sameLines(m[v], next) ? m : { ...m, [v]: next }));
  // Web: each version's measuring copy, as a DOM node.
  const measureNodes = useRef<Record<string, HTMLElement | null>>({});
  const [width, setWidth] = useState(0);
  const [suffixWidth, setSuffixWidth] = useState(0);

  const versions = alternate != null && alternate !== text ? [text, alternate] : [text];
  const lines = layouts[text];
  const measured = lines !== undefined && width > 0 && suffixWidth > 0;
  const clamped =
    !expanded && measured ? clampWithSuffix(lines, clampLines, width, suffixWidth) : null;
  const viewMore = t("post.viewMore");
  const cut = clamped !== null;

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
        accessibilityActions={cut ? [{ name: "activate", label: viewMore }] : []}
        onAccessibilityAction={() => setExpanded(true)}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {clamped !== null ? (
          <Text style={textStyle}>
            {renderText ? renderText(clamped) : clamped}{" "}
            <Text style={viewMoreStyle} onPress={() => setExpanded(true)} suppressHighlighting>
              {viewMore}
            </Text>
          </Text>
        ) : (
          <Text style={textStyle} numberOfLines={expanded || measured ? undefined : clampLines}>
            {renderText ? renderText(text) : text}
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
              ref={
                WEB
                  ? (node) => {
                      measureNodes.current[v] = node as unknown as HTMLElement | null;
                    }
                  : undefined
              }
              onTextLayout={(e) =>
                setLines(
                  v,
                  e.nativeEvent.lines.map((l) => ({ text: l.text, width: l.width })),
                )
              }
              onLayout={
                WEB
                  ? () => {
                      const node = measureNodes.current[v];
                      if (node) setLines(v, webLines(node, clampLines));
                    }
                  : undefined
              }
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
            onLayout={WEB ? (e) => setSuffixWidth(e.nativeEvent.layout.width) : undefined}
          >
            {/* The web cut is exact, so it measures the "…" too. */}
            {WEB ? "… " : " "}
            <Text style={viewMoreStyle}>{viewMore}</Text>
          </Text>
        </View>
      </View>
    </AnimatedHeight>
  );
}

const WEB = Platform.OS === "web";

/** The lines a laid-out DOM text node wraps into, like native `onTextLayout`:
 * each character joins the line its box sits on (a newline, which has no box
 * of its own, stays on the line it ends). Lines past `maxLines` are folded
 * into one, all `clampWithSuffix` needs to know there is more. */
function webLines(el: HTMLElement, maxLines: number): Line[] {
  const box = el.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const lines: Line[] = [];
  let firstTop: number | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const str = node.textContent ?? "";
    for (let i = 0; i < str.length;) {
      const len = (str.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
      const ch = str.slice(i, i + len);
      let index = Math.max(lines.length - 1, 0);
      let right = box.left;
      if (ch !== "\n") {
        range.setStart(node, i);
        range.setEnd(node, i + len);
        const rect = range.getBoundingClientRect();
        if (rect.height > 0) {
          firstTop ??= rect.top;
          const step = Number.isNaN(lineHeight) ? rect.height : lineHeight;
          index = Math.round((rect.top - firstTop) / step);
          right = rect.right;
        }
      }
      index = Math.min(index, maxLines);
      while (lines.length <= index) lines.push({ text: "", width: 0, charEnds: [] });
      const line = lines[index];
      line.text += ch;
      line.width = Math.max(line.width, right - box.left);
      line.charEnds!.push(line.width);
      i += len;
    }
  }
  return lines;
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
