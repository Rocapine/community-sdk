// An admin's "Pin" / "Unpin" entry in a post's "…" menu, and the per-topic pin limit.
import {
  countPinnedPosts,
  useCommunityConfig,
  useMyUid,
  usePinPost,
  useProfile,
  type FeedPost,
} from "@rocapine/community-core";
import { useCallback } from "react";
import { Alert, type AlertButton } from "react-native";
import { useT } from "../ThemeProvider";

/** Whether `topic` has room for one more pin (`maxPinnedPerTopic`); when it has
 * none, warns and answers false. A failed count lets the pin through. */
export function usePinRoom(): (topic: string) => Promise<boolean> {
  const cfg = useCommunityConfig();
  const t = useT();
  return useCallback(
    async (topic: string) => {
      const pinned = await countPinnedPosts(cfg, topic).catch(() => 0);
      if (pinned < cfg.maxPinnedPerTopic) return true;
      Alert.alert(t("pin.limitTitle"), t("pin.limitBody", { topic: t(`topics.${topic}`) }));
      return false;
    },
    [cfg, t],
  );
}

/** The pin entry for this post's menu: none unless the reader is an admin. */
export function usePinMenu(): (post: FeedPost) => AlertButton[] {
  const t = useT();
  const admin = useProfile(useMyUid()).data?.admin ?? false;
  const { mutate } = usePinPost();
  const hasRoom = usePinRoom();
  return useCallback(
    (post: FeedPost) => {
      if (!admin) return [];
      const pinned = post.pinnedAt != null;
      return [
        {
          text: t(pinned ? "post.unpin" : "post.pin"),
          onPress: async () => {
            if (!pinned && post.topic && !(await hasRoom(post.topic))) return;
            mutate({ postId: post.id, pinned: !pinned });
          },
        },
      ];
    },
    [admin, t, mutate, hasRoom],
  );
}
