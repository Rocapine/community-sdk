// Where the SDK's messaging callbacks land in this app (feed, inbox, chat).
import { router } from "expo-router";

/** A group: its conversation, read-only when I'm not a member. */
export function openGroup(groupId: string, preview = false) {
  router.push({
    pathname: "/conversation/[id]",
    params: { id: groupId, ...(preview ? { preview: "1" } : {}) },
  });
}

/** The feed's and the inbox's `onOpenMessages`. */
export function openMessages(target?: {
  conversationId?: string;
  groupId?: string;
  preview?: boolean;
  tab?: "conversations" | "groups";
}) {
  if (target?.groupId) return openGroup(target.groupId, target.preview);
  if (target?.conversationId) return openGroup(target.conversationId);
  router.push({ pathname: "/messages", params: target?.tab ? { tab: target.tab } : {} });
}
