// Full-screen dismissible notice for a rejected post/comment, or a network
// failure. Ported from the mold's `NoticeCard`
// (`sdk/client/components/community/NoticeCard.tsx`). Renders itself
// absolutely-positioned (`StyleSheet.absoluteFillObject`), so a host places
// it directly over its feed screen — no layout wiring needed at the call
// site.
//
// Signature change from the mold (task brief): `kind` collapses the mold's
// three-way `"post" | "comment" | "error"` into two — `"rejected"` |
// `"network"` — since a host consuming this SDK does not necessarily know
// which kind of content was rejected by the time it needs to show the
// notice. `"rejected"` reads the catalog's post-rejection copy
// (`notice.rejectedPostBody`) by default.
//
// `target` (added in Task 12's review round, cross-file touch explicitly
// authorized there): optional, defaults to `"post"`. When a caller *does*
// know it was a comment that got rejected (`ThreadSheet`'s own comment
// composer always does), passing `target="comment"` swaps in
// `notice.rejectedCommentBody` instead — narrower than forcing every comment-
// rejection caller to reach for `translations.overrides` just to get the
// mold's existing comment copy.

import { ShieldWarning } from "phosphor-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";

export function NoticeCard({
  kind,
  target = "post",
  onDismiss,
}: {
  kind: "rejected" | "network";
  target?: "post" | "comment";
  onDismiss(): void;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const styles = useThemedStyles(makeStyles);

  const title = kind === "network" ? t("notice.errorTitle") : t("notice.rejectedTitle");
  const body =
    kind === "network"
      ? t("notice.errorBody")
      : target === "comment"
        ? t("notice.rejectedCommentBody")
        : t("notice.rejectedPostBody");

  const handleDismiss = () => {
    Haptics.selectionAsync().catch(() => {});
    onDismiss();
  };

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />
      <Animated.View entering={FadeInDown.duration(220)} style={styles.card}>
        <View style={styles.icon}>
          <ShieldWarning size={26} color={theme.colors.accent} weight="fill" />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable
          onPress={handleDismiss}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonLabel}>{t("notice.gotIt")}</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(8,6,3,0.6)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing(8),
    },
    card: {
      width: "100%",
      maxWidth: 340,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingVertical: theme.spacing(7),
      paddingHorizontal: theme.spacing(6),
      alignItems: "center",
    },
    icon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing(4),
    },
    title: {
      fontFamily: theme.fonts.serifBold,
      fontSize: 20,
      color: theme.colors.textPrimary,
      textAlign: "center",
      marginBottom: theme.spacing(2.5),
    },
    body: {
      fontFamily: theme.fonts.regular,
      fontSize: 14.5,
      lineHeight: 21,
      color: theme.colors.textMuted,
      textAlign: "center",
      marginBottom: theme.spacing(5.5),
    },
    button: {
      alignSelf: "stretch",
      backgroundColor: theme.colors.textPrimary,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(3.5),
      alignItems: "center",
    },
    buttonPressed: { opacity: 0.9 },
    buttonLabel: {
      fontFamily: theme.fonts.bold,
      fontSize: 15,
      color: theme.colors.textInverse,
    },
  });
}
