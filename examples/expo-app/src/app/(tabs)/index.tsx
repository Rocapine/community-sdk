import { CommunityFeedScreen } from "@rocapine/community-ui";
import { router, useIsFocused } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";
import { headerConfig } from "@/playground";

export default function CommunityTab() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { settings } = usePlayground();
  return (
    <View
      style={{
        flex: 1,
        // With `topInset`, the feed owns the status bar area itself.
        paddingTop: settings.backgrounds.ownStatusBar ? 0 : insets.top,
        backgroundColor: settings.colors.background,
      }}
    >
      <CommunityFeedScreen
        isFocused={isFocused}
        header={headerConfig(settings.header, settings.backgrounds, insets.top)}
        onOpenProfile={(userId) =>
          router.push({ pathname: "/profile/[userId]", params: { userId } })
        }
        onOpenInbox={() => router.push("/inbox")}
      />
    </View>
  );
}
