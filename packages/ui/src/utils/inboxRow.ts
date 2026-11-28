// The text of a notification row, shared by the built-in row and a host's own
// (`renderInboxRow`'s `meta.parts`). Pure, so it is unit-testable.
import type { InboxItem } from "@rocapine/community-core";
import type { TFn } from "../i18n";
import { inboxExcerpt } from "./postImage";
import { formatTimeAgo } from "./time";

export function inboxRowText(
  t: TFn,
  item: InboxItem,
  nowMs: number,
): { title: string; excerpt: string | null; timeLabel: string } {
  return {
    title: rowTitle(t, item),
    excerpt: inboxExcerpt(item.payload.postExcerpt, t),
    timeLabel: formatTimeAgo(t, item.createdAt, nowMs),
  };
}

/** The group events of the groups module (inbox/005 names their group). */
export const GROUP_INBOX_KINDS: readonly string[] = [
  "group_approved",
  "group_field_rejected",
  "group_member_removed",
];

/** Where tapping a row goes: its post, or its group (`GROUP_INBOX_KINDS`). A removed
 * member gets the group's preview (it says they were removed, or lets them join again
 * once readmitted); with `groups.preview: "none"` there is nothing to open. */
export function inboxRowTarget(
  item: InboxItem,
  groupsPreview: "readOnly" | "none",
): { postId: string } | { groupId: string; preview?: true } | null {
  if (GROUP_INBOX_KINDS.includes(item.kind)) {
    if (!item.groupId) return null;
    if (item.kind !== "group_member_removed") return { groupId: item.groupId };
    return groupsPreview === "readOnly" ? { groupId: item.groupId, preview: true } : null;
  }
  return item.postId ? { postId: item.postId } : null;
}

function rowTitle(t: TFn, item: InboxItem): string {
  const actor = item.actorName?.trim();
  // An announcement with no named author reads "News from the team" (a host
  // overrides `inbox.newsFromTeam` with its own name), not "from Someone".
  if (item.kind === "admin_post" && !actor) return t("inbox.newsFromTeam");
  const name = actor || t("inbox.someone");
  switch (item.kind) {
    case "like":
      return t("inbox.liked", { name });
    case "comment":
      return t("inbox.commented", { name });
    case "reply":
      return t("inbox.replied", { name });
    case "reaction":
      return t("inbox.reacted", { name });
    case "admin_post":
      return t("inbox.news", { name });
    case "group_approved":
      return t("inbox.groupApproved");
    case "group_field_rejected":
      return t("inbox.groupFieldRejected");
    case "group_member_removed":
      return t("inbox.groupMemberRemoved");
    default:
      return "";
  }
}
