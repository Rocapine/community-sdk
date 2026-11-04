// The example's own reaction button: an emoji chip that reads and toggles the
// reaction through the slot context alone (no reaction hook needed).
import type { FeedPost } from "@rocapine/community-core";
import type { PostSlotContext } from "@rocapine/community-ui";
import { Pressable, Text } from "react-native";

export function ReactionChip({
  label,
  ctx,
}: {
  post: FeedPost;
  label: string;
  ctx: PostSlotContext;
}) {
  const { active, count, toggle } = ctx.reaction;
  return (
    <Pressable
      onPress={toggle}
      hitSlop={6}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        backgroundColor: active ? "#6C4DF6" : "rgba(108,77,246,0.12)",
      }}
    >
      <Text style={{ fontSize: 14 }}>🙌</Text>
      <Text style={{ fontSize: 13, fontWeight: "600", color: active ? "#FFF" : "#6C4DF6" }}>
        {label || "Cheer"}
        {count > 0 ? ` · ${count}` : ""}
      </Text>
    </Pressable>
  );
}
