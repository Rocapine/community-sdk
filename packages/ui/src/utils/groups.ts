// Pure helpers of the groups screens (Messages page, Explore, details, members).
import type { Conversation, Group, MessagingErrorCode } from "@rocapine/community-core";
import type { TFn } from "../i18n";

/** "X online", or null at 0: presence is shown, absence never. The count leaves me
 * out (groups/007): `group_online_counts` counts the other members. */
export function onlineLabel(count: number, t: TFn): string | null {
  return count > 0 ? t("chat.online", { count }) : null;
}

/** An Explore row's button. */
export function exploreRowAction(group: Pick<Group, "isMember">): "join" | "open" {
  return group.isMember ? "open" : "join";
}

/** Tapping an Explore row: open my group, preview another one, or join it straight
 * away when previews are off (`groups.preview: "none"`). */
export function exploreRowTap(
  group: Pick<Group, "isMember">,
  preview: "readOnly" | "none",
): "open" | "preview" | "join" {
  if (group.isMember) return "open";
  return preview === "none" ? "join" : "preview";
}

/** As the server's `can_manage_group`: an app admin, or the group's creator while still
 * an active member with that role (not who `created_by` names after a transfer). */
export function canManage(group: Pick<Group, "myRole">, isAdmin: boolean): boolean {
  return group.myRole === "creator" || isAdmin;
}

/** The SDK's own account check before joining (`requireAccount: true`) or creating
 * (`createRequiresAccount`): true when the host must ask for an account first. Unknown
 * (`null`, or no accounts module) lets the backend decide. */
export function needsAccount(rule: boolean, linked: boolean | null): boolean {
  return rule && linked === false;
}

const ERROR_KEYS: Partial<Record<MessagingErrorCode, string>> = {
  name_required: "groups.error.nameRequired",
  description_required: "groups.error.descriptionRequired",
  name_too_long: "groups.error.nameTooLong",
  description_too_long: "groups.error.descriptionTooLong",
  too_many_groups: "groups.error.tooManyGroups",
  too_many_joined: "groups.error.tooManyJoined",
  group_full: "groups.error.groupFull",
  removed_from_group: "groups.error.removed",
  banned: "groups.error.banned",
  // groups/006: an edit cooldown (5 per group per hour).
  rate_limited: "groups.error.editLimit",
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
  /** A DM: the peer's message goes without their name. */
  dm = false,
): string {
  if (!last) return t("messages.noMessages");
  const text = last.body ? last.body.replace(/\s+/g, " ").trim() : t("image.photo");
  if (last.authorId === myUid) return t("messages.you", { text });
  return dm ? text : t("messages.author", { name: authorName ?? "", text });
}

/** A DM row's line and count. Across a block (no peer, either way) neither side reads
 * the DM: the "can't write" line instead of a preview (never my own older message),
 * and no count. */
export function dmRowSummary(
  c: Pick<Conversation, "peerId" | "lastMessage" | "unread">,
  myUid: string | null,
  t: TFn,
): { preview: string; unread: number } {
  if (!c.peerId) return { preview: t("chat.blocked"), unread: 0 };
  return { preview: lastMessagePreview(c.lastMessage, myUid, null, t, true), unread: c.unread };
}

/** The host gate before joining: the screen's own `beforeJoinGroup`, else the feed's
 * `beforeCompose` when `requireAccount: "feed"`, else none. */
export function joinGate(
  beforeJoinGroup: (() => Promise<boolean>) | undefined,
  requireAccount: boolean | "feed",
  beforeCompose: (() => Promise<boolean>) | undefined,
): (() => Promise<boolean>) | undefined {
  return beforeJoinGroup ?? (requireAccount === "feed" ? beforeCompose : undefined);
}

/** Joining, in order: the SDK's account check (`requireAccount: true` and no linked
 * account ⇒ the host is asked, nothing else runs), then the host gate (a throw counts as
 * "no"), then the join. */
export async function guardedJoin(steps: {
  accountMissing: boolean;
  onAccountRequired(): void;
  gate?: () => Promise<boolean>;
  join(): void;
}): Promise<"account" | "refused" | "joined"> {
  if (steps.accountMissing) {
    steps.onAccountRequired();
    return "account";
  }
  const allowed = steps.gate ? await steps.gate().catch(() => false) : true;
  if (!allowed) return "refused";
  steps.join();
  return "joined";
}
