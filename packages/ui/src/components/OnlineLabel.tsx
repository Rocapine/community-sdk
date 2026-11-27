// "● 3 online" in the theme's success green, like the avatars' online dot; nothing at
// 0 (presence is shown, absence never). A Text, so it also sits inside a line of
// stats ("12 members · ● 3 online") and takes that line's font.
import { Text, type StyleProp, type TextStyle } from "react-native";
import { useCommunityTheme, useT } from "../ThemeProvider";
import { onlineLabel } from "../utils/groups";

export function OnlineLabel({ count, style }: { count: number; style?: StyleProp<TextStyle> }) {
  const t = useT();
  const theme = useCommunityTheme();
  const label = onlineLabel(count, t);
  if (!label) return null;
  return (
    <Text style={[style, { color: theme.colors.success }]} accessibilityLabel={label}>
      {`● ${label}`}
    </Text>
  );
}
