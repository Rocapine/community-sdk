import { ConversationScreen } from "@rocapine/community-ui";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";
import { openGroup } from "@/routes";

export default function ConversationRoute() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { settings } = usePlayground();
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        backgroundColor: settings.colors.background,
      }}
    >
      <ConversationScreen
        conversationId={id}
        mode={preview ? "preview" : "member"}
        isFocused={isFocused}
        onOpenProfile={(userId) =>
          router.push({ pathname: "/profile/[userId]", params: { userId } })
        }
        onOpenGroupDetails={() => router.push({ pathname: "/group/[id]", params: { id } })}
        onOpenGroup={openGroup}
        onBack={router.back}
      />
    </View>
  );
}
