// The green "online" dot at an avatar's bottom-right corner. Presence is only ever
// shown, never its absence: there is no grey/offline variant.
import { useEffect, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useCommunityTheme, useT } from "../ThemeProvider";
import { onlineDotMetrics } from "../utils/onlineDot";

export function OnlineDot({
  size,
  ringColor,
  pulseOnce,
}: {
  size: number;
  /** The surface behind the avatar, so the ring reads as a cut-out. */
  ringColor: string;
  /** One expanding ring when the dot appears (profile header). */
  pulseOnce?: boolean;
}): ReactElement {
  const t = useT();
  const theme = useCommunityTheme();
  const reduceMotion = useReducedMotion();
  const { dot, ring } = onlineDotMetrics(size);
  const outer = dot + 2 * ring;
  const pulse = useSharedValue(0);
  const pulsing = !!pulseOnce && !reduceMotion;

  useEffect(() => {
    if (pulsing) pulse.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) });
  }, [pulsing, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.8 * (1 - pulse.value),
    transform: [{ scale: 0.7 + (2.6 - 0.7) * pulse.value }],
  }));

  return (
    <View
      accessible
      accessibilityLabel={t("a11y.online")}
      style={[styles.slot, { width: outer, height: outer }]}
    >
      {pulsing ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.fill,
            { borderRadius: outer / 2, backgroundColor: theme.colors.success },
            pulseStyle,
          ]}
        />
      ) : null}
      <View
        style={[
          styles.fill,
          {
            borderRadius: outer / 2,
            backgroundColor: theme.colors.success,
            borderWidth: ring,
            borderColor: ringColor,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute", right: 0, bottom: 0 },
  fill: { ...StyleSheet.absoluteFillObject },
});
