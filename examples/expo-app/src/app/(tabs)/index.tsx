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
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: settings.colors.background }}>
      <CommunityFeedScreen
        isFocused={isFocused}
        header={headerConfig(settings.header)}
        onOpenProfile={(userId) =>
          router.push({ pathname: "/profile/[userId]", params: { userId } })
        }
        onOpenInbox={() => router.push("/inbox")}
      />
    </View>
  );
}
