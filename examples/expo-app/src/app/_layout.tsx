import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PlaygroundProvider } from "@/PlaygroundProvider";

// Web: the stack hides the screen it leaves with aria-hidden while the clicked button keeps
// focus (Chrome: "Blocked aria-hidden on an element because its descendant retained focus").
// A mouse click needs no focus left on its button: drop it before the press handler navigates.
if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener(
    "click",
    (e) => {
      const el = document.activeElement;
      if (e.detail > 0 && el instanceof HTMLElement && el.closest('[role="button"], button')) {
        el.blur();
      }
    },
    true,
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PlaygroundProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </PlaygroundProvider>
    </GestureHandlerRootView>
  );
}
