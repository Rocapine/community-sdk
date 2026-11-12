import { BlockedMembersScreen } from "@rocapine/community-ui";
import { router } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";

export default function BlockedRoute() {
  const insets = useSafeAreaInsets();
  const { settings } = usePlayground();
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: settings.colors.background }}>
      <BlockedMembersScreen onBack={router.back} />
    </View>
  );
}
