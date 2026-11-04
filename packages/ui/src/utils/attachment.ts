// Whether an attachment handed to the composer (a share from the app) may go out:
// a type the app enabled, and an author allowed to attach. Otherwise the composer
// opens without it.
import {
  canAttach,
  type PostAttachment,
  type ResolvedCommunityConfig,
} from "@rocapine/community-core";

export function allowedAttachment(
  cfg: ResolvedCommunityConfig,
  official: boolean,
  attachment: PostAttachment | undefined | null,
): PostAttachment | null {
  if (!attachment || !cfg.modules.attachments) return null;
  if (!cfg.modules.attachments.types.includes(attachment.type)) {
    console.warn(
      `[@rocapine/community-ui] attachment type "${attachment.type}" is not in modules.attachments.types`,
    );
    return null;
  }
  if (!canAttach(cfg, official)) {
    console.warn(
      "[@rocapine/community-ui] only official accounts can attach (modules.attachments.membersCanAttach is false)",
    );
    return null;
  }
  return attachment;
}
