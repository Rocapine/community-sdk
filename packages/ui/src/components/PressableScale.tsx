// Every tappable element of the package goes through this Pressable: it
// shrinks a touch and dims slightly while held (UI thread, Reanimated, so it
// stays smooth during JS work), and fires an optional haptic on press.
import * as Haptics from "expo-haptics";
import {
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressed scale by element size: an icon can shrink further than a card
 * without looking broken. */
const SCALES = { icon: 0.9, button: 0.96, surface: 0.985 } as const;
const PRESSED_OPACITY = 0.85;

export type HapticKind = "selection" | "light" | "medium" | "success";

/** Light (`selection`) for plain UI — chips, toggles, navigation; `medium` for
 * an action that commits something (like, reaction, publish); `success` for
 * an outcome. */
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
  // The animated opacity would override a static one (e.g. a disabled look).
  const staticOpacity = StyleSheet.flatten(style)?.opacity;
  const baseOpacity = typeof staticOpacity === "number" ? staticOpacity : 1;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: baseOpacity * (1 - (1 - PRESSED_OPACITY) * pressed.value),
    transform: [{ scale: 1 - (1 - to) * pressed.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => {
        pressed.value = withTiming(1, { duration: 90 });
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        pressed.value = withSpring(0, { damping: 18, stiffness: 320 });
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
