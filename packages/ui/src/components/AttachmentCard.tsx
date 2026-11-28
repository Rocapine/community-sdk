// A post's attachment (attachments module): the host draws the card from its own
// data (`renderAttachment`) and opens the content (`onOpenAttachment`). Inside the
// thread sheet, opening goes through the modal handoff so the sheet closes first.
// A `group` attachment the host doesn't draw gets the SDK's own card (groups module).
import { groupsSettings, useCommunityConfig, type PostAttachment } from "@rocapine/community-core";
import { useContext, type ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  useAttachmentHandlers,
  useCommunityIcons,
  useT,
  type AttachmentPlacement,
  type AttachmentVariant,
} from "../ThemeProvider";
import { attachmentRenderer, attachmentVariant } from "../utils/attachment";
import { ModalHandoffContext } from "../utils/modalHandoff";
import { GroupAttachment } from "./GroupAttachment";

export function AttachmentCard({
  attachment,
  placement,
  variant = "card",
  onOpen,
  onRemove,
}: {
  attachment: PostAttachment;
  placement: AttachmentPlacement;
  variant?: AttachmentVariant;
  /** Replaces the provider's `onOpenAttachment` (a screen's own prop). */
  onOpen?: (attachment: PostAttachment) => void;
  /** The composer's remove button. */
  onRemove?: () => void;
}): ReactElement | null {
  const { render, open } = useAttachmentHandlers();
  const presentModal = useContext(ModalHandoffContext);
  const icons = useCommunityIcons();
  const t = useT();
  const groups = groupsSettings(useCommunityConfig());
  const shown = attachmentVariant(attachment.type, variant, groups?.shareCardLayout ?? null);
  const node = render?.(attachment, {
    placement,
    variant: shown,
    open: () => presentModal(() => (onOpen ?? open)?.(attachment)),
  });
  const by = attachmentRenderer(attachment.type, node, !!groups);
  if (by === null) return null;
  return (
    <View style={styles.wrap}>
      {by === "host" ? (
        node
      ) : (
        <GroupAttachment
          groupId={attachment.id}
          variant={shown}
          interactive={placement !== "composer"}
        />
      )}
      {onRemove && (
        <Pressable
          hitSlop={10}
          onPress={onRemove}
          style={styles.remove}
          accessibilityRole="button"
          accessibilityLabel={t("composer.removeAttachment")}
        >
          <icons.close size={11} color="#FFFFFF" weight="bold" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch" },
  remove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
});
