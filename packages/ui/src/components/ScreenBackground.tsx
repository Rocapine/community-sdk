// The community's background image (`CommunityUIProvider`'s `background`), fixed
// behind the feed, the notification center and profiles. Nothing when unset.
import { Image } from "expo-image";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { useCommunityBackground } from "../ThemeProvider";

export function ScreenBackground(): ReactElement | null {
  const background = useCommunityBackground();
  if (!background) return null;
  return (
    <Image
      source={background.image}
      style={[StyleSheet.absoluteFill, { opacity: background.opacity ?? 1 }]}
      contentFit={background.contentFit ?? "cover"}
      pointerEvents="none"
    />
  );
}
