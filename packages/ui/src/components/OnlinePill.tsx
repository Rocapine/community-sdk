// The feed header's "online" item: a green dot and the live count, expanding to
// "N online" on the app's first launch (per JS runtime) and after a tap, then
// collapsing to dot + number. Presence is only ever shown, never its absence: it
// renders nothing while the count is unknown or under the module's `minCount`.
import { presenceSettings, useCommunityConfig, useOnlineCount } from "@rocapine/community-core";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { noFocusRing } from "../utils/noFocusRing";
import {
  claimColdStartExpansion,
  coldStartExpansionPending,
  countGluedToLabel,
  withoutCount,
} from "../utils/onlinePill";

const DOT = 8;
const SLIDE_MS = 350;
// The label fades out just before the pill shrinks and fades in just after it grows,
// so it is never seen cut off.
const FADE_OUT_MS = 110;
const SHRINK_DELAY_MS = 100;
const FADE_IN_DELAY_MS = 200;
const FADE_IN_MS = 200;
const PULSE_MS = 1600;
// 32pt pill + this on each side = the 44pt target of the sibling header buttons.
const HIT_SLOP = { top: 6, bottom: 6 } as const;

export function OnlinePill(): ReactElement | null {
  const cfg = useCommunityConfig();
  const count = useOnlineCount();
  const settings = presenceSettings(cfg);
  if (!settings || count === null || count < settings.minCount) return null;
  return <Pill count={count} collapseAfterMs={settings.collapseAfterMs} />;
}

function Pill({
  count,
  collapseAfterMs,
}: {
  count: number;
  collapseAfterMs: number | false;
}): ReactElement {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  // Read without side effects (StrictMode renders twice); claimed on mount below.
  const [expanded, setExpanded] = useState(coldStartExpansionPending);
  const [labelWidth, setLabelWidth] = useState(0);
  const [taps, setTaps] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = useSharedValue(expanded ? 1 : 0);
  const fade = useSharedValue(expanded ? 1 : 0);
  const pulse = useSharedValue(0);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    claimColdStartExpansion();
  }, []);

  // (Re)start the collapse timer whenever the pill is expanded; none when it stays open.
  useEffect(() => {
    clearTimer();
    if (expanded && collapseAfterMs !== false) {
      timer.current = setTimeout(() => setExpanded(false), collapseAfterMs);
    }
    return clearTimer;
  }, [expanded, taps, collapseAfterMs]);

  useEffect(() => {
    const target = expanded ? 1 : 0;
    if (reduceMotion) {
      open.value = target;
      fade.value = target;
      return;
    }
    const slide = withTiming(target, { duration: SLIDE_MS, easing: Easing.out(Easing.cubic) });
    if (expanded) {
      open.value = slide;
      fade.value = withDelay(
        FADE_IN_DELAY_MS,
        withTiming(1, { duration: FADE_IN_MS, easing: Easing.in(Easing.quad) }),
      );
    } else {
      fade.value = withTiming(0, { duration: FADE_OUT_MS, easing: Easing.out(Easing.quad) });
      open.value = withDelay(SHRINK_DELAY_MS, slide);
    }
  }, [expanded, reduceMotion, open, fade]);

  // The dot's halo loops while expanded (two beats only when the pill never
  // collapses), and never under Reduce Motion.
  const pulsing = expanded && !reduceMotion;
  useEffect(() => {
    if (!pulsing) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }),
      collapseAfterMs === false ? 2 : -1,
    );
    return () => cancelAnimation(pulse);
  }, [pulsing, pulse, collapseAfterMs]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - pulse.value),
    transform: [{ scale: 1 + 2 * pulse.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    width: labelWidth * open.value,
    opacity: fade.value,
  }));

  const text = t("presence.count", { count });
  const label = withoutCount(text, count);
  const glued = countGluedToLabel(text, count);
  const labelStyles = glued ? [styles.label, styles.labelGlued] : styles.label;
  const onPress = useCallback(() => {
    setExpanded(true);
    setTaps((n) => n + 1); // a tap while open restarts the collapse countdown
  }, []);
  // Until the label is measured, an expanded pill lays it out at natural width but
  // keeps it invisible, so the first paint never snaps; collapsed, it takes no room.
  const measured = labelWidth > 0;
  const labelClipStyle = measured
    ? labelStyle
    : expanded
      ? styles.unmeasuredOpen
      : styles.unmeasuredClosed;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={t("a11y.onlineCount", { count })}
      hitSlop={HIT_SLOP}
      style={styles.pill}
    >
      <View pointerEvents="none" style={styles.bg} />
      <View style={styles.dotSlot} importantForAccessibility="no-hide-descendants">
        <Animated.View style={[styles.dot, haloStyle]} />
        <View style={styles.dot} />
      </View>
      <Text style={styles.count} accessible={false} importantForAccessibility="no">
        {count}
      </Text>
      {/* Invisible copy, only there to read the label's natural width. */}
      <Text
        style={[labelStyles, styles.measure]}
        numberOfLines={1}
        accessible={false}
        importantForAccessibility="no"
        pointerEvents="none"
        onLayout={(e) => setLabelWidth(Math.ceil(e.nativeEvent.layout.width))}
      >
        {label}
      </Text>
      <Animated.View
        style={[styles.labelClip, labelClipStyle]}
        importantForAccessibility="no-hide-descendants"
      >
        {/* Pinned to its measured width: clipped by the pill, never ellipsized. */}
        <Text
          style={[labelStyles, measured && { width: labelWidth }]}
          numberOfLines={1}
          ellipsizeMode="clip"
          accessible={false}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (theme: CommunityTheme) =>
  StyleSheet.create({
    pill: {
      height: 32,
      minWidth: 32,
      paddingHorizontal: theme.spacing(2.5),
      borderRadius: theme.radius.pill,
      flexDirection: "row",
      alignItems: "center",
      overflow: "hidden",
      ...noFocusRing,
    },
    bg: { ...StyleSheet.absoluteFill, backgroundColor: theme.colors.success, opacity: 0.14 },
    dotSlot: { width: DOT, height: DOT, marginRight: theme.spacing(1.5) },
    dot: {
      ...StyleSheet.absoluteFill,
      borderRadius: DOT / 2,
      backgroundColor: theme.colors.success,
    },
    count: {
      ...theme.typography.caption,
      color: theme.colors.headerText,
      fontVariant: ["tabular-nums"],
    },
    measure: { position: "absolute", left: 0, opacity: 0 },
    unmeasuredOpen: { opacity: 0 },
    unmeasuredClosed: { width: 0, opacity: 0 },
    labelClip: { overflow: "hidden", flexDirection: "row" },
    label: {
      ...theme.typography.caption,
      color: theme.colors.headerText,
      paddingLeft: theme.spacing(1),
      flexShrink: 0,
    },
    labelGlued: { paddingLeft: 0 },
  });
