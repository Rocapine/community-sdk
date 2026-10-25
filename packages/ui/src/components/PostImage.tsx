// A post/comment image in its display frame (aspect kept, clamped to
// 4:5 .. 1.91:1, center-cropped beyond). The frame is sized from the stored
// width/height, so its space is reserved on the first layout pass — nothing
// moves when the bytes arrive. Tapping it opens the full-screen viewer.
import type { PostImage as PostImageData } from "@rocapine/community-core";
import { Image } from "expo-image";
import { StyleSheet } from "react-native";
import { useCommunityTheme, useT } from "../ThemeProvider";
import { imageFrame, imageRatio } from "../utils/postImage";
import { PressableScale } from "./PressableScale";

export function PostImage({
  image,
  maxWidth,
  onOpen,
}: {
  image: PostImageData;
  /** Frame width in px. Omitted: fills the parent's width (feed/thread card),
   * with the height following from the ratio — no measuring pass. */
  maxWidth?: number;
  onOpen: (image: PostImageData) => void;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const frame =
    maxWidth != null
      ? imageFrame(image, maxWidth)
      : { width: "100%" as const, aspectRatio: imageRatio(image) };
  return (
    <PressableScale
      scale="surface"
      onPress={() => onOpen(image)}
      accessibilityRole="imagebutton"
      accessibilityLabel={t("a11y.openImage")}
      style={[
        frame,
        {
          borderRadius: theme.radius.md,
          overflow: "hidden",
          backgroundColor: theme.colors.surfaceMuted,
        },
      ]}
    >
      <Image source={{ uri: image.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
    </PressableScale>
  );
}
