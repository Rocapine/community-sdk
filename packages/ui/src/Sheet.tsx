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
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useCommunityTheme, useThemedStyles } from "./ThemeProvider";
import type { CommunityTheme } from "./theme";
import { sheetTransition } from "./utils/sheetLifecycle";

const FULL_SNAP_POINTS = ["94%"];
/** `snapTo="half"` sheets are content-sized, capped at this share of the window. */
const HALF_MAX_RATIO = 0.9;
/** Matches the old hand-rolled sheet's slide. Deterministic on both platforms
 * (gorhom's iOS default is a spring with a long tail), because callers hand
 * off to a second Modal a fixed delay after closing (`HANDOFF_DELAY_MS`). */
const ANIMATION_DURATION = 250;
const BACKDROP_COLOR = "rgb(8,6,3)";
const BACKDROP_OPACITY = 0.45;

type SheetCtx = { footer: ReactNode; bottomInset: number; contentBottomPad: number };
const SheetContext = createContext<SheetCtx>({ footer: null, bottomInset: 0, contentBottomPad: 0 });

export function CommunitySheet({
  visible,
  onClose,
  children,
  snapTo = "half",
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  snapTo?: "half" | "full";
  /** Pinned to the bottom of the sheet, right above the keyboard when open
   * (e.g. a comment composer). Scroll content is padded so it never hides
   * under it. */
  footer?: ReactNode;
}) {
  const [mounted, setMounted] = useState(visible);
  const sheetRef = useRef<BottomSheet>(null);
  const prevVisible = useRef(visible);
  const latest = useRef({ visible, onClose });
  latest.current = { visible, onClose };

  useEffect(() => {
    const action = sheetTransition(prevVisible.current, visible, mounted);
    prevVisible.current = visible;
    if (action === "mount") setMounted(true);
    else if (action === "close") sheetRef.current?.close();
    else if (action === "reopen") sheetRef.current?.snapToIndex(0);
    // Driven by `visible` only; `mounted` is read as of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // gorhom's `onClose` fires once the sheet reaches index -1, whatever closed
  // it (pan, backdrop tap, or our own `close()`). Unmount, and tell the
  // parent if it didn't ask for this close itself.
  const handleSheetClosed = () => {
    setMounted(false);
    if (latest.current.visible) latest.current.onClose();
  };

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
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
    // With a footer, gorhom adds the measured footer height on top of this
    // (`enableFooterMarginAdjustment`); the footer itself sits `insets.bottom`
    // above the screen edge.
    contentBottomPad: insets.bottom + (hasFooter ? 0 : theme.spacing(4)),
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

function SheetFooter(props: BottomSheetFooterProps) {
  const { footer, bottomInset } = useContext(SheetContext);
  const styles = useThemedStyles(makeStyles);
  return (
    <BottomSheetFooter {...props} bottomInset={bottomInset}>
      <View style={styles.footer}>{footer}</View>
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
      paddingBottom: theme.spacing(2.5),
    },
  });
}
