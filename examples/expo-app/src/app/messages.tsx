import { MessagesScreen } from "@rocapine/community-ui";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";
import { openGroup } from "@/routes";

export default function MessagesRoute() {
  const insets = useSafeAreaInsets();
  const { settings } = usePlayground();
  const { tab } = useLocalSearchParams<{ tab?: "conversations" | "groups" }>();
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: settings.colors.background }}>
      <MessagesScreen
        initialTab={tab}
        onOpenConversation={(id) => openGroup(id)}
        onOpenExplore={() => router.push("/explore")}
        onBack={router.back}
      />
    </View>
  );
}
