import { GroupMembersScreen } from "@rocapine/community-ui";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";

export default function GroupMembersRoute() {
  const insets = useSafeAreaInsets();
  const { settings } = usePlayground();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: settings.colors.background }}>
      <GroupMembersScreen
        groupId={id}
        onOpenProfile={(userId) =>
          router.push({ pathname: "/profile/[userId]", params: { userId } })
        }
        onBack={router.back}
      />
    </View>
  );
}
