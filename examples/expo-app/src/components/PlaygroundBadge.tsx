// The example's own `renderMemberBadge`: the SDK's pills for the streak badges, a
// plain pill for the showcase's other badges (pregnancy month, zodiac sign, rank).
import { defaultMemberBadge, type MemberBadgeRenderProps } from "@rocapine/community-ui";
import { Text, View } from "react-native";

const SIGNS: Record<string, string> = { leo: "♌ Leo", pisces: "♓ Pisces", aries: "♈ Aries" };

function text({ id, data }: MemberBadgeRenderProps): string | null {
  if (id === "pregnancy" && typeof data.month === "number") return `Month ${data.month}`;
  if (id === "zodiac" && typeof data.sign === "string") return SIGNS[data.sign] ?? data.sign;
  if (id === "rank" && typeof data.n === "number") return `#${data.n}`;
  return null;
}

export function renderPlaygroundBadge(p: MemberBadgeRenderProps) {
  const label = text(p);
  if (label == null) return defaultMemberBadge(p);
  const large = p.size === "large";
  return (
    <View
      style={{
        paddingHorizontal: large ? 11 : 7,
        height: large ? 28 : 20,
        borderRadius: 999,
        justifyContent: "center",
        backgroundColor: "rgba(108,77,246,0.14)",
      }}
    >
      <Text style={{ fontSize: large ? 14 : 11.5, fontWeight: "600", color: "#6C4DF6" }}>
        {label}
      </Text>
    </View>
  );
}
