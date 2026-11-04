// An admin's "Pin" / "Unpin" entry in a post's "…" menu.
import { useMyUid, usePinPost, useProfile, type FeedPost } from "@rocapine/community-core";
import { useCallback } from "react";
import type { AlertButton } from "react-native";
import { useT } from "../ThemeProvider";

/** The pin entry for this post's menu: none unless the reader is an admin. */
export function usePinMenu(): (post: FeedPost) => AlertButton[] {
  const t = useT();
  const admin = useProfile(useMyUid()).data?.admin ?? false;
  const { mutate } = usePinPost();
  return useCallback(
    (post: FeedPost) => {
      if (!admin) return [];
      const pinned = post.pinnedAt != null;
      return [
        {
          text: t(pinned ? "post.unpin" : "post.pin"),
          onPress: () => mutate({ postId: post.id, pinned: !pinned }),
        },
      ];
    },
    [admin, t, mutate],
  );
}
