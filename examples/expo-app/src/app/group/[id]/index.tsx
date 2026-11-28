import { GroupDetailsScreen } from "@rocapine/community-ui";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";

export default function GroupDetailsRoute() {
  const insets = useSafeAreaInsets();
  const { settings } = usePlayground();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: settings.colors.background }}>
      <GroupDetailsScreen
        groupId={id}
        onOpenMembers={() => router.push({ pathname: "/group/[id]/members", params: { id } })}
        // The feed's composer, opened with the group's card (`composeRequest`).
        onShare={(group) =>
          router.dismissTo({
            pathname: "/",
            params: { shareType: "group", shareId: group.id, at: String(Date.now()) },
          })
        }
        onLeft={() => router.dismissTo("/")}
        onBack={router.back}
      />
    </View>
  );
}
