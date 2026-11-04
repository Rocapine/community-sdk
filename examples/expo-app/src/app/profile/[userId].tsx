import { ProfileScreen, ThreadSheet } from "@rocapine/community-ui";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";

export default function ProfileRoute() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const { settings } = usePlayground();
  const [threadPostId, setThreadPostId] = useState<string | null>(null);
  const openProfile = (id: string) => {
    setThreadPostId(null);
    router.push({ pathname: "/profile/[userId]", params: { userId: id } });
  };
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: settings.colors.background }}>
      <ProfileScreen userId={userId} onOpenThread={setThreadPostId} onBack={router.back} />
      <ThreadSheet
        postId={threadPostId}
        onClose={() => setThreadPostId(null)}
        onOpenProfile={openProfile}
      />
    </View>
  );
}
