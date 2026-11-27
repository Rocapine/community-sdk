// Pure helpers of the groups screens (Messages page, Explore, details, members).
import type { Conversation, Group, MessagingErrorCode } from "@rocapine/community-core";
import type { TFn } from "../i18n";

/** "X online", or null at 0: presence is shown, absence never. */
export function onlineLabel(count: number, t: TFn): string | null {
  return count > 0 ? t("chat.online", { count }) : null;
}

/** "N members · X online" (the online part only above 0). */
export function groupStats(memberCount: number, online: number, t: TFn): string {
  const on = onlineLabel(online, t);
  const members = t("chat.members", { count: memberCount });
  return on ? `${members} · ${on}` : members;
}

/** An Explore row's button. */
export function exploreRowAction(group: Pick<Group, "isMember">): "join" | "open" {
  return group.isMember ? "open" : "join";
}

/** The group's creator and the app admins edit it and remove members. */
export function canManage(group: Pick<Group, "isCreator">, isAdmin: boolean): boolean {
  return group.isCreator || isAdmin;
}

const ERROR_KEYS: Partial<Record<MessagingErrorCode, string>> = {
  name_required: "groups.error.nameRequired",
  description_required: "groups.error.descriptionRequired",
  name_too_long: "groups.error.nameTooLong",
  description_too_long: "groups.error.descriptionTooLong",
  too_many_groups: "groups.error.tooManyGroups",
  too_many_joined: "groups.error.tooManyJoined",
  group_full: "groups.error.groupFull",
};

/** The copy for a failed create, edit or join. */
export function groupErrorKey(code: MessagingErrorCode): string {
  return ERROR_KEYS[code] ?? "groups.error.generic";
}

/** A Messages row's second line: "Ana: text", "You: text", one line. */
export function lastMessagePreview(
  last: Conversation["lastMessage"],
  myUid: string | null,
  authorName: string | null,
  t: TFn,
): string {
  if (!last) return t("messages.noMessages");
  const text = last.body ? last.body.replace(/\s+/g, " ").trim() : t("image.photo");
  return last.authorId === myUid
    ? t("messages.you", { text })
    : t("messages.author", { name: authorName ?? "", text });
}
