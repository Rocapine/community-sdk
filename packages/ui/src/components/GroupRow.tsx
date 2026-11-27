// One group in Explore (validated mockup A: compact row; B: card with a banner,
// `exploreLayout: "cards"`): picture, name, description, "N members · X online"
// and a Join / Open button. Tapping the row opens the group (a preview when not a
// member); the button joins, or opens.
import type { Group } from "@rocapine/community-core";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { exploreRowAction, onlineLabel } from "../utils/groups";
import { initialOf } from "../utils/initial";
import { Avatar } from "./Avatar";
import { PressableScale } from "./PressableScale";

export function GroupRow({
  group,
  online,
  layout,
  busy,
  onPress,
  onAction,
}: {
  group: Group;
  online: number;
  layout: "list" | "cards";
  /** The join is on its way. */
  busy: boolean;
  onPress(): void;
  onAction(action: "join" | "open"): void;
}) {
  const t = useT();
  const theme = useCommunityTheme();
  const styles = useThemedStyles(makeStyles);
  const action = exploreRowAction(group);
  const members = t("chat.members", { count: group.memberCount });
  const on = onlineLabel(online, t);

  const stats = (
    <Text style={styles.stats} numberOfLines={1}>
      {members}
      {on && (
        <>
          {" · "}
          <Text style={styles.online}>{on}</Text>
        </>
      )}
    </Text>
  );
  const button = (
    <PressableScale
      onPress={() => onAction(action)}
      disabled={busy}
      haptic={action === "join" ? "medium" : "selection"}
      accessibilityLabel={`${t(action === "join" ? "chat.join" : "groups.open")}, ${group.name}`}
      style={[styles.button, action === "open" && styles.ghost]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.colors.textInverse} />
      ) : (
        <Text style={[styles.buttonLabel, action === "open" && styles.ghostLabel]}>
          {t(action === "join" ? "chat.join" : "groups.open")}
        </Text>
      )}
    </PressableScale>
  );
  const a11y = [group.name, members, on].filter(Boolean).join(", ");

  if (layout === "cards")
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={a11y}
      >
        {group.imageUrl ? (
          <Image source={{ uri: group.imageUrl }} style={styles.banner} contentFit="cover" />
        ) : (
          <View style={[styles.banner, styles.bannerEmpty]}>
            <Text style={styles.bannerInitial}>{initialOf(group.name)}</Text>
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.name} numberOfLines={1}>
            {group.name}
          </Text>
          {!!group.description && (
            <Text style={styles.description} numberOfLines={2}>
              {group.description}
            </Text>
          )}
          <View style={styles.cardFooter}>
            <View style={styles.flex}>{stats}</View>
            {button}
          </View>
        </View>
      </Pressable>
    );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <Avatar userId={null} name={group.name} url={group.imageUrl} size={44} placement="group" />
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>
          {group.name}
        </Text>
        {!!group.description && (
          <Text style={styles.description} numberOfLines={1}>
            {group.description}
          </Text>
        )}
        {stats}
      </View>
      {button}
    </Pressable>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.hairline,
    },
    pressed: { opacity: 0.7 },
    name: {
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textPrimary,
    },
    description: { ...theme.typography.meta, color: theme.colors.textMuted },
    stats: { ...theme.typography.caption, color: theme.colors.textFaint, marginTop: 2 },
    online: { color: theme.colors.success },
    button: {
      minWidth: 72,
      minHeight: 32,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing(3.5),
    },
    ghost: { backgroundColor: theme.colors.surfaceMuted },
    buttonLabel: {
      ...theme.typography.meta,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textInverse,
    },
    ghostLabel: { color: theme.colors.textPrimary },
    card: {
      marginHorizontal: theme.spacing(4),
      marginBottom: theme.spacing(3),
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
    },
    banner: { height: 88, width: "100%" },
    bannerEmpty: {
      backgroundColor: theme.colors.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    bannerInitial: { ...theme.typography.display, color: theme.colors.accent },
    cardBody: { padding: theme.spacing(3), gap: 2 },
    cardFooter: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      marginTop: theme.spacing(2),
    },
  });
}
