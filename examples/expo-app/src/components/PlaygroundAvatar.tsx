// The example's own `renderAvatar`: the photo or initial, with a ring on admin
// accounts when the Config tab asks for one. Shows how a host reads the avatar's
// context (`admin`, `placement`, `badges`…).
import type { AvatarRenderProps } from "@rocapine/community-ui";
import { Image } from "expo-image";
import { Text, View } from "react-native";

export function PlaygroundAvatar({
  name,
  url,
  size,
  admin,
  ring,
  accent,
}: AvatarRenderProps & { ring: boolean; accent: string }) {
  const showRing = ring && admin;
  const inner = showRing ? size - 6 : size;
  const round = { width: inner, height: inner, borderRadius: inner / 2 };
  const face = url ? (
    <Image source={{ uri: url }} style={round} contentFit="cover" />
  ) : (
    <View
      style={[
        round,
        { backgroundColor: "#EEEEF1", alignItems: "center", justifyContent: "center" },
      ]}
    >
      <Text style={{ fontSize: Math.round(inner * 0.44), fontWeight: "700", color: accent }}>
        {name.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
  if (!showRing) return face;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: "#C49B00",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {face}
    </View>
  );
}
