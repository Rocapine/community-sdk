// Self-contained bottom sheet used by every community popup (thread, report,
// rules, profile edit, …). Ported from the mold's `Sheet` in
// `sdk/client/components/community/ui.tsx`, with its host-only dependencies
// dissolved:
//  - `react-native-gesture-handler` (swipe-to-dismiss) is NOT a peer dep of
//    this package, so the pan gesture is dropped — dismissal is tap-backdrop
//    or the host's own close button, no drag handle interaction.
//  - `expo-blur` is NOT a peer dep either, so the backdrop is a plain
//    semi-transparent `View` instead of a blurred one.
//  - `react-native-safe-area-context` is NOT a peer dep, so there is no real
//    inset measurement; a fixed home-indicator-sized bottom pad is used
//    instead. Hosts that need exact insets can wrap `children` in their own
//    `SafeAreaView`.
//  - The mold's spring-physics slide is replaced with `withTiming` per the
//    task brief.
//
// All styling comes from `useCommunityTheme()` — no color/font literals.

import { useEffect, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useThemedStyles } from "./ThemeProvider";
import type { CommunityTheme } from "./theme";

const OPEN_DURATION = 260;
const CLOSE_DURATION = 220;

// No react-native-safe-area-context peer dep (see file header) — a fixed
// home-indicator-sized pad substitutes for a real bottom inset.
const BOTTOM_PAD = Platform.OS === "ios" ? 34 : 16;

const SNAP_RATIO: Record<"half" | "full", number> = { half: 0.6, full: 0.94 };

export function CommunitySheet({
  visible,
  onClose,
  children,
  snapTo = "half",
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  snapTo?: "half" | "full";
}) {
  const { height: screenH } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const styles = useThemedStyles(makeStyles);

  const translateY = useSharedValue(screenH);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = withTiming(0, {
        duration: OPEN_DURATION,
        easing: Easing.out(Easing.cubic),
      });
      backdropOpacity.value = withTiming(1, { duration: OPEN_DURATION });
    } else {
      backdropOpacity.value = withTiming(0, { duration: CLOSE_DURATION });
      translateY.value = withTiming(
        screenH,
        { duration: CLOSE_DURATION, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
  }, [visible, screenH, translateY, backdropOpacity]);

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropAnimatedStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropAnimatedStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        {/* KAV wraps the animated sheet panel (not the backdrop) so its
            keyboard-height padding pushes the whole panel up, above the
            keyboard, while staying bottom-anchored via the root's own
            `justifyContent: "flex-end"`. It sits OUTSIDE the `Animated.View`
            on purpose: `transform` (the slide-up/down animation) is a
            paint-time effect that doesn't participate in flex layout, so
            KAV's layout-time padding and reanimated's `translateY` compose
            without fighting — each one only ever moves the panel along an
            axis the other doesn't touch. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.kav}
        >
          <Animated.View
            style={[
              styles.sheet,
              { maxHeight: screenH * SNAP_RATIO[snapTo], paddingBottom: BOTTOM_PAD },
              sheetAnimatedStyle,
            ]}
          >
            <View style={styles.handleZone}>
              <View style={styles.handle} />
            </View>
            {children}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    kav: { width: "100%" },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(8,6,3,0.45)",
    },
    sheet: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing(5.5),
      paddingTop: theme.spacing(1.5),
      ...theme.shadow,
    },
    handleZone: { alignItems: "center", paddingVertical: theme.spacing(2.5) },
    handle: {
      width: 40,
      height: 5,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.hairline,
    },
  });
}
