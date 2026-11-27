// Whether an attachment handed to the composer (a share from the app) may go out:
// a type the app enabled (or the built-in group card), and an author allowed to attach.
// Otherwise the composer opens without it. And who draws an attachment, in which variant.
import {
  attachmentTypeAllowed,
  canAttach,
  type PostAttachment,
  type ResolvedCommunityConfig,
} from "@rocapine/community-core";

export function allowedAttachment(
  cfg: ResolvedCommunityConfig,
  admin: boolean,
  attachment: PostAttachment | undefined | null,
): PostAttachment | null {
  if (!attachment) return null;
  if (!attachmentTypeAllowed(cfg, attachment.type)) {
    if (cfg.modules.attachments)
      console.warn(
        `[@rocapine/community-ui] attachment type "${attachment.type}" is not in modules.attachments.types`,
      );
    return null;
  }
  if (!canAttach(cfg, admin, attachment.type)) {
    console.warn(
      "[@rocapine/community-ui] only admin accounts can attach (modules.attachments.membersCanAttach is false)",
    );
    return null;
  }
  return attachment;
}

/** Who draws an attachment: the host when its `renderAttachment` returns something,
 * else the SDK's own card for a `group` (groups module on), else nobody. */
export function attachmentRenderer(
  type: string,
  hostNode: unknown,
  groupsOn: boolean,
): "host" | "group" | null {
  if (hostNode != null) return "host";
  return type === "group" && groupsOn ? "group" : null;
}

/** A group card in a post follows `groups.shareCardLayout`; a bubble's stays compact. */
export function attachmentVariant(
  type: string,
  variant: "card" | "banner" | "compact",
  shareCardLayout: "card" | "banner" | null,
): "card" | "banner" | "compact" {
  return type === "group" && variant === "card" && shareCardLayout ? shareCardLayout : variant;
}
