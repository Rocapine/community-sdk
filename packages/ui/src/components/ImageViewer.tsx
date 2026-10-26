// Full-screen image viewer: black backdrop, pinch and double-tap to zoom, pan
// while zoomed, swipe down (unzoomed) or the close button to dismiss.
//
// Two ways to host it, never a second Modal over the thread sheet (iOS froze
// on a Modal stacked over the thread's Modal, 0.4.2):
//  - `ImageViewerHost` (feed, profile): renders the viewer in its own RN
//    `Modal`, and provides `ImageViewerContext`.
//  - `useImageViewerOverlay` (thread sheet): returns `open` for the context
//    and an `overlay` layer that `CommunitySheet` renders inside its existing
//    Modal, above the sheet.
//
// Gestures: Gesture Handler's builder API (`Gesture.*` + `GestureDetector`)
// and Reanimated's shared values / `withTiming` / `runOnJS` — exported by both
// reanimated 3 and 4 (where `runOnJS` is a deprecated re-export from
// react-native-worklets) and gesture-handler 2 and 3.
import type { PostImage } from "@rocapine/community-core";
import { Image } from "expo-image";
import { createContext, useState, type ReactNode } from "react";
import { Keyboard, Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useCommunityIcons, useCommunityTheme, useT } from "../ThemeProvider";

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2;
/** Unzoomed drag distance / fling speed that dismisses. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
const DURATION = 220;
const BACKDROP = "#000";

/** Opens the viewer on an image. Default: no viewer mounted, does nothing. */
export const ImageViewerContext = createContext<(image: PostImage) => void>(() => {});

/** Feed/profile host: provides `ImageViewerContext` and shows the viewer in
 * its own Modal. */
export function ImageViewerHost({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<PostImage | null>(null);
  const close = () => setImage(null);
  return (
    <ImageViewerContext.Provider value={setImage}>
      {children}
      {image && (
        <Modal
          visible
          transparent
          animationType="none"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={close}
        >
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <GestureHandlerRootView style={styles.fill}>
              <ImageViewer image={image} onClose={close} />
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </Modal>
      )}
    </ImageViewerContext.Provider>
  );
}

/** Thread-sheet host: provide `open` through `ImageViewerContext` and pass
 * `overlay` to `CommunitySheet` — it renders inside the sheet's own Modal.
 * `close` is for the sheet's Android back press while the viewer is up. */
export function useImageViewerOverlay(): {
  open: (image: PostImage) => void;
  close: () => void;
  overlay: ReactNode;
} {
  const [image, setImage] = useState<PostImage | null>(null);
  const open = (next: PostImage) => {
    Keyboard.dismiss();
    setImage(next);
  };
  const close = () => setImage(null);
  const overlay = image ? <ImageViewer image={image} onClose={close} /> : null;
  return { open, close, overlay };
}

function ImageViewer({ image, onClose }: { image: PostImage; onClose: () => void }) {
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // `contain` box of the image on screen, to bound panning while zoomed.
  const ratio = image.width / image.height;
  const fitW = Math.min(winW, winH * ratio);
  const fitH = fitW / ratio;

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const dismissY = useSharedValue(0);

  const close = () => {
    if (reduceMotion) return onClose();
    dismissY.value = withTiming(winH, { duration: DURATION }, (done) => {
      "worklet";
      if (done) runOnJS(onClose)();
    });
  };

  const clampPan = (s: number) => {
    "worklet";
    const maxX = Math.max(0, (fitW * s - winW) / 2);
    const maxY = Math.max(0, (fitH * s - winH) / 2);
    x.value = Math.min(Math.max(x.value, -maxX), maxX);
    y.value = Math.min(Math.max(y.value, -maxY), maxY);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), MAX_SCALE);
      clampPan(scale.value);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedX.value = x.value;
      savedY.value = y.value;
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onUpdate((e) => {
      if (savedScale.value > 1) {
        x.value = savedX.value + e.translationX;
        y.value = savedY.value + e.translationY;
        clampPan(scale.value);
      } else {
        dismissY.value = Math.max(0, e.translationY);
      }
    })
    .onEnd((e) => {
      if (savedScale.value > 1) {
        savedX.value = x.value;
        savedY.value = y.value;
      } else if (dismissY.value > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        runOnJS(close)();
      } else {
        dismissY.value = withTiming(0, { duration: DURATION });
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const to = savedScale.value > 1 ? 1 : DOUBLE_TAP_SCALE;
      scale.value = withTiming(to, { duration: DURATION });
      x.value = withTiming(0, { duration: DURATION });
      y.value = withTiming(0, { duration: DURATION });
      savedScale.value = to;
      savedX.value = 0;
      savedY.value = 0;
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(dismissY.value / (winH / 2), 1),
  }));
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value + dismissY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
        <Animated.View style={[styles.fill, imageStyle]}>
          <Image source={{ uri: image.url }} style={styles.fill} contentFit="contain" />
        </Animated.View>
      </GestureDetector>
      <Pressable
        onPress={close}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("a11y.closeImage")}
        style={[styles.close, { top: insets.top + theme.spacing(2), right: theme.spacing(4) }]}
      >
        <icons.close size={24} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { backgroundColor: BACKDROP },
  close: {
    position: "absolute",
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
