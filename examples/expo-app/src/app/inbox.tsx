import { NotificationInboxScreen, ThreadSheet } from "@rocapine/community-ui";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";
import { CardInboxRow } from "@/components/CardInboxRow";

export default function InboxRoute() {
  const insets = useSafeAreaInsets();
  const { settings } = usePlayground();
  const [threadPostId, setThreadPostId] = useState<string | null>(null);
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: settings.colors.background }}>
      <NotificationInboxScreen
        onOpenPost={setThreadPostId}
        onBack={router.back}
        onOpenCommunity={router.back}
        renderInboxRow={
          settings.inboxRow === "card"
            ? (_item, defaults, meta) => (defaults ? <CardInboxRow meta={meta} /> : null)
            : undefined
        }
      />
      <ThreadSheet
        postId={threadPostId}
        onClose={() => setThreadPostId(null)}
        onOpenProfile={(userId) => {
          setThreadPostId(null);
          router.push({ pathname: "/profile/[userId]", params: { userId } });
        }}
      />
    </View>
  );
}
