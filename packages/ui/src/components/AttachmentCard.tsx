// A post's attachment (attachments module): the host draws the card from its own
// data (`renderAttachment`) and opens the content (`onOpenAttachment`). Inside the
// thread sheet, opening goes through the modal handoff so the sheet closes first.
import type { PostAttachment } from "@rocapine/community-core";
import { useContext, type ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  useAttachmentHandlers,
  useCommunityIcons,
  useT,
  type AttachmentPlacement,
} from "../ThemeProvider";
import { ModalHandoffContext } from "../utils/modalHandoff";

export function AttachmentCard({
  attachment,
  placement,
  onRemove,
}: {
  attachment: PostAttachment;
  placement: AttachmentPlacement;
  /** The composer's remove button. */
  onRemove?: () => void;
}): ReactElement | null {
  const { render, open } = useAttachmentHandlers();
  const presentModal = useContext(ModalHandoffContext);
  const icons = useCommunityIcons();
  const t = useT();
  const node = render?.(attachment, {
    placement,
    open: () => presentModal(() => open?.(attachment)),
  });
  if (node == null) return null;
  return (
    <View style={styles.wrap}>
      {node}
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
