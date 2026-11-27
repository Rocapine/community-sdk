import { ExploreGroupsScreen } from "@rocapine/community-ui";
import { router } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";
import { openGroup } from "@/routes";

export default function ExploreRoute() {
  const insets = useSafeAreaInsets();
  const { settings } = usePlayground();
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: settings.colors.background }}>
      <ExploreGroupsScreen onOpenGroup={openGroup} onBack={router.back} />
    </View>
  );
}
