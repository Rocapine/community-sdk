// Bottom sheet used by every community popup (thread, report, rules, profile
// edit). Built on `@gorhom/bottom-sheet`, the de-facto RN standard, instead of
// a hand-rolled panel: it gives us swipe-down-to-close from the handle (and
// from scroll content already at the top, coordinated with the scroll view),
// and keyboard handling that keeps a `footer` pinned right above the keyboard
// while the scroll content shrinks to fit — no `KeyboardAvoidingView`.
//
// Self-contained on purpose — hosts add no provider:
//  - gorhom's `BottomSheet` (not `BottomSheetModal`, which needs a
//    `BottomSheetModalProvider` at the app root) is rendered inside an RN
//    `Modal`, so it always sits above the host's navigation.
//  - The Modal holds its own `GestureHandlerRootView` (required for gestures
//    inside an Android Modal, harmless on iOS) and its own
//    `SafeAreaProvider` (seeded from the parent provider when the host has
//    one, else from `initialWindowMetrics`) for the top/bottom insets.
// Peer deps: `@gorhom/bottom-sheet`, `react-native-gesture-handler`,
// `react-native-safe-area-context` (all JS-only for hosts that already ship
// gesture-handler + reanimated natively, as every Expo app does).
//
// Children must use the content primitives exported below (`SheetScrollView`,
// `SheetView`, `SheetTextInput`) — gorhom needs its own scrollable/view/input
// to coordinate scroll vs. pan, measure dynamic sizing and track the
// keyboard. They also apply the sheet's horizontal padding and bottom inset.
//
// All styling comes from `useCommunityTheme()` — no color/font literals
// except the backdrop dim, which is part of the sheet's look.

import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
  KEYBOARD_STATUS,
  useBottomSheetInternal,
  useBottomSheetTimingConfigs,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useCommunityTheme, useThemedStyles } from "./ThemeProvider";
import type { CommunityTheme } from "./theme";
import { sheetTransition, type SheetPhase } from "./utils/sheetLifecycle";

const FULL_SNAP_POINTS = ["94%"];
/** `snapTo="half"` sheets are content-sized, capped at this share of the window. */
const HALF_MAX_RATIO = 0.9;
/** Matches the old hand-rolled sheet's slide, on both platforms (gorhom's iOS
 * default is an overdamped spring with a long settling tail). */
const ANIMATION_DURATION = 250;
const BACKDROP_COLOR = "rgb(8,6,3)";
const BACKDROP_OPACITY = 0.45;

type SheetCtx = { footer: ReactNode; bottomInset: number; contentBottomPad: number };
const SheetContext = createContext<SheetCtx>({ footer: null, bottomInset: 0, contentBottomPad: 0 });

export function CommunitySheet({
  visible,
  onClose,
  onDismissed,
  children,
  snapTo = "half",
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fired once the sheet is fully gone: close animation done AND the native
   * Modal dismissed. Open another Modal-based sheet from here (iOS silently
   * refuses to present one while another is being dismissed). */
  onDismissed?: () => void;
  children: ReactNode;
  snapTo?: "half" | "full";
  /** Pinned to the bottom of the sheet, right above the keyboard when open
   * (e.g. a comment composer). Scroll content is padded so it never hides
   * under it. */
  footer?: ReactNode;
}) {
  const [phase, setPhase] = useState<SheetPhase>(visible ? "open" : "hidden");
  const sheetRef = useRef<BottomSheet>(null);
  const prevVisible = useRef(visible);
  const prevPhase = useRef(phase);
  const latest = useRef({ visible, onClose, onDismissed });
  latest.current = { visible, onClose, onDismissed };

  useEffect(() => {
    const action = sheetTransition(prevVisible.current, visible, phase);
    prevVisible.current = visible;
    if (action === "mount") setPhase("open");
    else if (action === "close") sheetRef.current?.close();
    else if (action === "reopen") sheetRef.current?.snapToIndex(0);
    // Driven by `visible` only; `phase` is read as of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Fully gone: tell the parent, then honour a re-open that arrived while
  // the Modal was still being dismissed.
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (phase !== "hidden" || was === "hidden") return;
    latest.current.onDismissed?.();
    if (latest.current.visible) setPhase("open");
  }, [phase]);

  // gorhom's `onClose` fires once the sheet reaches index -1, whatever closed
  // it (pan, backdrop tap, or our own `close()`). Dismiss the Modal — on iOS
  // it stays rendered with `visible={false}` until its `onDismiss`; Android
  // has no `onDismiss`, so unmount straight away — and tell the parent if it
  // didn't ask for this close itself.
  const handleSheetClosed = () => {
    setPhase(Platform.OS === "ios" ? "dismissing" : "hidden");
    if (latest.current.visible) latest.current.onClose();
  };

  if (phase === "hidden") return null;

  return (
    <Modal
      visible={phase === "open"}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={() => setPhase("hidden")}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SheetBody
            sheetRef={sheetRef}
            snapTo={snapTo}
            footer={footer}
            onSheetClosed={handleSheetClosed}
          >
            {children}
          </SheetBody>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </Modal>
  );
}

/** Split from `CommunitySheet` so `useSafeAreaInsets` runs under the Modal's
 * own `SafeAreaProvider`. */
function SheetBody({
  sheetRef,
  snapTo,
  footer,
  onSheetClosed,
  children,
}: {
  sheetRef: RefObject<BottomSheet | null>;
  snapTo: "half" | "full";
  footer: ReactNode;
  onSheetClosed: () => void;
  children: ReactNode;
}) {
  const theme = useCommunityTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const animationConfigs = useBottomSheetTimingConfigs({ duration: ANIMATION_DURATION });

  const hasFooter = footer != null && footer !== false;
  const ctx: SheetCtx = {
    footer: hasFooter ? footer : null,
    bottomInset: insets.bottom,
    // With a footer, gorhom adds the measured footer height instead
    // (`enableFooterMarginAdjustment`); that height already includes the
    // footer's own bottom inset padding.
    contentBottomPad: hasFooter ? 0 : insets.bottom + theme.spacing(4),
  };

  const sizing =
    snapTo === "full"
      ? { snapPoints: FULL_SNAP_POINTS, enableDynamicSizing: false }
      : { enableDynamicSizing: true, maxDynamicContentSize: windowH * HALF_MAX_RATIO };

  return (
    <SheetContext.Provider value={ctx}>
      <BottomSheet
        ref={sheetRef}
        index={0}
        {...sizing}
        enablePanDownToClose
        animationConfigs={animationConfigs}
        topInset={insets.top}
        // Full sheets are already at their max height: "extend" keeps them
        // put and shrinks the content above the keyboard (footer rides on
        // it). Content-sized sheets have no higher snap point to extend to,
        // so they must move up by the keyboard height instead.
        keyboardBehavior={snapTo === "full" ? "extend" : "interactive"}
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        onClose={onSheetClosed}
        backdropComponent={SheetBackdrop}
        footerComponent={hasFooter ? SheetFooter : undefined}
        backgroundStyle={styles.background}
        handleStyle={styles.handleZone}
        handleIndicatorStyle={styles.handle}
      >
        {children}
      </BottomSheet>
    </SheetContext.Provider>
  );
}

// Module-level (stable identity) on purpose: gorhom renders these as element
// types, so an inline arrow would remount them — and blur the footer's
// TextInput — on every parent render. The footer content arrives by context.
function SheetBackdrop(props: BottomSheetBackdropProps) {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
      opacity={BACKDROP_OPACITY}
      style={[props.style, { backgroundColor: BACKDROP_COLOR }]}
    />
  );
}

// Not lifted by gorhom's `bottomInset`: the footer reaches the screen edge
// and pads the home-indicator strip itself (sheet background, so nothing
// scrolls visibly beneath it). With the keyboard up it sits on the keyboard,
// so the inset padding is dropped.
function SheetFooter(props: BottomSheetFooterProps) {
  const { footer, bottomInset } = useContext(SheetContext);
  const theme = useCommunityTheme();
  const styles = useThemedStyles(makeStyles);
  const { animatedKeyboardState } = useBottomSheetInternal();
  const gap = theme.spacing(2.5);
  const padStyle = useAnimatedStyle(
    () => ({
      paddingBottom:
        animatedKeyboardState.get().status === KEYBOARD_STATUS.SHOWN ? gap : gap + bottomInset,
    }),
    [gap, bottomInset],
  );
  return (
    <BottomSheetFooter {...props}>
      <Animated.View style={[styles.footer, padStyle]}>{footer}</Animated.View>
    </BottomSheetFooter>
  );
}

/** Scroll container for sheet content (gorhom's, so scrolling and
 * pan-to-close coordinate). Adds the sheet's horizontal padding and bottom
 * inset / footer clearance on top of the caller's `contentContainerStyle`. */
export function SheetScrollView({
  contentContainerStyle,
  ...rest
}: Omit<ComponentProps<typeof BottomSheetScrollView>, "contentContainerStyle"> & {
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const { footer, contentBottomPad } = useContext(SheetContext);
  const styles = useThemedStyles(makeStyles);
  const own = StyleSheet.flatten(contentContainerStyle) ?? {};
  const ownPad = typeof own.paddingBottom === "number" ? own.paddingBottom : 0;
  return (
    <BottomSheetScrollView
      {...rest}
      enableFooterMarginAdjustment={footer != null}
      // A single flat object: gorhom's footer adjustment only reads
      // `paddingBottom` off a flat style.
      contentContainerStyle={StyleSheet.flatten([
        styles.content,
        own,
        { paddingBottom: ownPad + contentBottomPad },
      ])}
    />
  );
}

/** Static (non-scrolling) sheet content; required as the root child for
 * content-sized (`snapTo="half"`) sheets. */
export function SheetView({ style, ...rest }: ComponentProps<typeof BottomSheetView>) {
  const { contentBottomPad } = useContext(SheetContext);
  const styles = useThemedStyles(makeStyles);
  return (
    <BottomSheetView
      {...rest}
      style={[styles.content, { paddingBottom: contentBottomPad }, style]}
    />
  );
}

/** Any text field inside a sheet must be this one: gorhom tracks its focus
 * to handle the keyboard (iOS). */
export const SheetTextInput = BottomSheetTextInput;

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    background: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      ...theme.shadow,
    },
    handleZone: { paddingTop: theme.spacing(4), paddingBottom: theme.spacing(2.5) },
    handle: {
      width: 40,
      height: 5,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.hairline,
    },
    content: { paddingHorizontal: theme.spacing(5.5) },
    footer: {
      backgroundColor: theme.colors.background,
      paddingHorizontal: theme.spacing(5.5),
    },
  });
}
