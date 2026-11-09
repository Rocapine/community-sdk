// The example's `renderAttachment`: a card drawn from its own catalogue, with the
// app's call to action. The post only stores `{ type, id }`.
import type { PostAttachment } from "@rocapine/community-core";
import type { RenderAttachment } from "@rocapine/community-ui";
import { Alert, Pressable, Text, View } from "react-native";
import { findItem } from "@/catalog";

export const renderPlaygroundAttachment: RenderAttachment = (attachment, { placement, open }) => {
  const item = findItem(attachment.type, attachment.id);
  if (!item) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        backgroundColor: "#FFFFFF",
        borderWidth: 1,
        borderColor: "rgba(20,20,25,0.08)",
      }}
    >
      <Text style={{ fontSize: 30 }}>{item.emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: "600" }}>{item.title}</Text>
        <Text style={{ fontSize: 13, color: "#6B6B73" }}>{item.meta}</Text>
      </View>
      {placement !== "composer" && (
        <Pressable
          onPress={open}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: "#6C4DF6",
          }}
        >
          <Text style={{ color: "#FFF", fontWeight: "600", fontSize: 13 }}>
            {item.type === "recipe" ? "+ Plan" : "Start"}
          </Text>
        </Pressable>
      )}
    </View>
  );
};

export function openPlaygroundAttachment(attachment: PostAttachment) {
  const item = findItem(attachment.type, attachment.id);
  Alert.alert(
    item?.type === "recipe" ? "Open the recipe" : "Start the session",
    `The app would now open “${item?.title ?? attachment.id}”.`,
  );
}
