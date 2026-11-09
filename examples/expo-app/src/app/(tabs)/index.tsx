import { CommunityFeedScreen } from "@rocapine/community-ui";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";
import { headerConfig } from "@/playground";
import { ReactionChip } from "@/components/ReactionChip";

export default function CommunityTab() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { settings } = usePlayground();
  // A "Share" from the catalog lands here with the item in the params.
  const { shareType, shareId, at } = useLocalSearchParams<{
    shareType?: string;
    shareId?: string;
    at?: string;
  }>();
  const composeRequest = useMemo(
    () =>
      shareType && shareId && at
        ? { attachment: { type: shareType, id: shareId }, requestedAt: Number(at) }
        : undefined,
    [shareType, shareId, at],
  );
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
        composeRequest={composeRequest}
        slots={
          settings.reaction.chip
            ? {
                renderReactionButton: (post, _default, ctx) => (
                  <ReactionChip post={post} label={settings.reaction.label} ctx={ctx} />
                ),
              }
            : undefined
        }
        onOpenProfile={(userId) =>
          router.push({ pathname: "/profile/[userId]", params: { userId } })
        }
        onOpenInbox={() => router.push("/inbox")}
      />
    </View>
  );
}
