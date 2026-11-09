// The example's own notification row (GoodBoy's cards): rebuilt from the SDK's
// row parts, opening the post through `meta.open`.
import type { InboxRowMeta } from "@rocapine/community-ui";
import { Pressable, Text, View } from "react-native";

export function CardInboxRow({ meta }: { meta: InboxRowMeta }) {
  const { parts, unread, open } = meta;
  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 12,
        marginHorizontal: 16,
        marginVertical: 6,
        padding: 14,
        borderRadius: 18,
        backgroundColor: unread ? "#F1ECFF" : "#FFFFFF",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {parts.icon}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: unread ? "700" : "500" }}>{parts.title}</Text>
        {parts.excerpt ? (
          <Text style={{ fontSize: 13, color: "#6B6B73" }} numberOfLines={1}>
            “{parts.excerpt}”
          </Text>
        ) : null}
        <Text style={{ fontSize: 12, color: "#9A9AA2" }}>{parts.timeLabel}</Text>
      </View>
    </Pressable>
  );
}
