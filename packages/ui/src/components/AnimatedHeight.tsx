// A box whose height follows its content and animates when the content's
// height changes (a post switching between original and translation, a
// comment expanding, a poll label wrapping differently in the other
// language). The height is a real layout value animated on the UI thread, so
// everything below — the rest of the card, the next cards in the list — is
// re-laid out every frame and glides with it; nothing else needs its own
// transition.
//
// How: the content sits in an inner view whose natural height is measured on
// every layout. The outer view is `auto` until the first measure, then pinned
// to the measured height. When the content changes, the commit that swaps it
// still renders the outer view at the old height (so there is no one-frame
// jump), and the new measure animates the pin to the new height. Overflow is
// clipped while growing, so the new text is revealed as the box opens. The
// animation honours the system Reduce Motion setting (Reanimated default).
//
// Once measured, the inner view is positioned absolutely: an in-flow child of
// a fixed-height box gets that height as its layout budget, so a text that
// now needs more lines is measured — and truncated — at the old height and
// the box never grows (seen on poll labels). Absolutely positioned, it is
// measured at its natural height. The first render stays in flow so the box
// has its height from the first frame; the switch to absolute happens in the
// same commit that pins the box to that height (a React style, not only the
// animated one, so there is no frame where the box is unpinned and empty).
import { useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const DURATION_MS = 240;
const EASING = Easing.out(Easing.cubic);

export function AnimatedHeight({
  children,
  style,
}: {
  children: ReactNode;
  /** Style of the outer box (e.g. `flex: 1` inside a row). */
  style?: StyleProp<ViewStyle>;
}) {
  // -1 / null = not measured yet: the box lays out naturally (first render,
  // list mount) and never animates from zero.
  const height = useSharedValue(-1);
  const [firstHeight, setFirstHeight] = useState<number | null>(null);
  const animatedStyle = useAnimatedStyle(() => (height.value < 0 ? {} : { height: height.value }));

  return (
    <Animated.View
      style={[
        style,
        styles.clip,
        firstHeight === null ? undefined : { height: firstHeight },
        animatedStyle,
      ]}
    >
      <View
        style={firstHeight === null ? undefined : styles.floating}
        onLayout={(e) => {
          const next = e.nativeEvent.layout.height;
          if (firstHeight === null) {
            height.value = next;
            setFirstHeight(next);
          } else if (Math.abs(height.value - next) > 0.5) {
            height.value = withTiming(next, { duration: DURATION_MS, easing: EASING });
          }
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  floating: { position: "absolute", top: 0, left: 0, right: 0 },
});
