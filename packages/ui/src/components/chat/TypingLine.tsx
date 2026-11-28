// "Marc is typing…" above the composer; "Several people are typing…" for more.
import { useProfile } from "@rocapine/community-core";
import { StyleSheet, Text } from "react-native";
import { useT, useThemedStyles } from "../../ThemeProvider";
import type { CommunityTheme } from "../../theme";

export function TypingLine({ userIds }: { userIds: string[] }) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const name = useProfile(userIds[0] ?? null).data?.name;
  if (userIds.length === 0 || (userIds.length === 1 && !name)) return null;
  const text =
    userIds.length > 1 ? t("chat.typing.several") : t("chat.typing.one", { name: name! });
  return (
    <Text style={styles.typing} numberOfLines={1} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    typing: {
      ...theme.typography.caption,
      color: theme.colors.textMuted,
      paddingHorizontal: theme.spacing(4),
      // Its own band between the list and the composer: a bubble cut at the list's edge
      // never touches it.
      paddingTop: theme.spacing(1.5),
      paddingBottom: theme.spacing(1.5),
    },
  });
}
