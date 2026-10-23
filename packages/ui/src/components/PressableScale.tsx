// Press feedback for the package's buttons with a visible surface (pills,
// chips, cards): a barely-there scale-down while held, on the UI thread
// (Reanimated) — no opacity change, no spring. Icon buttons and text links
// use a plain `Pressable`: their state change (or the screen they open) is the
// feedback.
import * as Haptics from "expo-haptics";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressed scale: a button can give a little more than a whole card. */
const SCALES = { button: 0.98, surface: 0.99 } as const;
const EASE_OUT = Easing.out(Easing.quad);

export type HapticKind = "selection" | "light" | "medium" | "success";

/** `selection` when a choice changes (chip, topic, toggle); `light`/`medium`
 * when something is committed (undo / like, reaction, vote, publish, send);
 * `success` for an outcome. Never on plain navigation. */
export function haptic(kind: HapticKind): void {
  const run =
    kind === "selection"
      ? Haptics.selectionAsync()
      : kind === "success"
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : Haptics.impactAsync(
            kind === "light"
              ? Haptics.ImpactFeedbackStyle.Light
              : Haptics.ImpactFeedbackStyle.Medium,
          );
  run.catch(() => {});
}

export function PressableScale({
  scale = "button",
  haptic: hapticKind,
  onPress,
  onPressIn,
  onPressOut,
  style,
  ...rest
}: Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  scale?: keyof typeof SCALES;
  haptic?: HapticKind;
}) {
  const pressed = useSharedValue(0);
  const to = SCALES[scale];
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - to) * pressed.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => {
        pressed.value = withTiming(1, { duration: 80, easing: EASE_OUT });
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        pressed.value = withTiming(0, { duration: 160, easing: EASE_OUT });
        onPressOut?.(e);
      }}
      onPress={
        onPress &&
        ((e: GestureResponderEvent) => {
          if (hapticKind) haptic(hapticKind);
          onPress(e);
        })
      }
      style={[style, animatedStyle]}
    />
  );
}
