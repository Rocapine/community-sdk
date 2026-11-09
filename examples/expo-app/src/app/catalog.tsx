// A stand-in for an app's detail pages: each item can be shared into the community.
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CATALOG } from "@/catalog";

export default function CatalogRoute() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, padding: 16, gap: 12 }}>
      <Pressable onPress={() => router.back()}>
        <Text style={{ fontSize: 16, color: "#6C4DF6" }}>‹ Back</Text>
      </Pressable>
      <Text style={{ fontSize: 28, fontWeight: "700" }}>Catalog</Text>
      {CATALOG.map((item) => (
        <View
          key={`${item.type}:${item.id}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 12,
            borderRadius: 16,
            backgroundColor: "#FFF",
          }}
        >
          <Text style={{ fontSize: 30 }}>{item.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "600" }}>{item.title}</Text>
            <Text style={{ fontSize: 13, color: "#6B6B73" }}>{item.meta}</Text>
          </View>
          <Pressable
            onPress={() =>
              router.navigate({
                pathname: "/",
                params: { shareType: item.type, shareId: item.id, at: String(Date.now()) },
              })
            }
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: "#6C4DF6",
            }}
          >
            <Text style={{ color: "#6C4DF6", fontWeight: "600" }}>Share</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
