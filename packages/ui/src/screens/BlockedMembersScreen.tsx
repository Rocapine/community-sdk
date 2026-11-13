// The members I blocked, newest first, each with an Unblock button. A plain
// screen like `NotificationInboxScreen`: the host mounts it (typically from its
// settings) and owns the safe area. A block hides both members from each other
// (core/016_mutual_blocks.sql), so this list is the only way back to them.

import { useBlockedMembers, useUnblockUser, type BlockedMember } from "@rocapine/community-core";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { Avatar } from "../components/Avatar";
import { PressableScale } from "../components/PressableScale";
import { ScreenBackground } from "../components/ScreenBackground";
import { isQueryLoading } from "../utils/query";

export function BlockedMembersScreen({ onBack }: { onBack?: () => void }) {
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const blocked = useBlockedMembers();
  const unblock = useUnblockUser();
  const members = blocked.data ?? [];

  const askUnblock = (member: BlockedMember) =>
    Alert.alert(
      t("menu.unblockUserConfirmTitle", { name: member.name }),
      t("menu.unblockUserConfirmBody"),
      [
        { text: t("menu.cancel"), style: "cancel" },
        { text: t("menu.unblock"), onPress: () => unblock.mutate({ userId: member.id }) },
      ],
    );

  return (
    <View style={styles.root}>
      <ScreenBackground />
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {onBack && (
            <Pressable
              onPress={onBack}
              style={styles.headerButton}
              accessibilityRole="button"
              accessibilityLabel={t("a11y.back")}
            >
              <icons.back size={22} color={theme.colors.textPrimary} weight="bold" />
            </Pressable>
          )}
        </View>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {t("blocked.title")}
        </Text>
        <View style={styles.headerSide} />
      </View>

      {isQueryLoading(blocked) ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
      ) : blocked.isError ? (
        <Text style={styles.empty}>{t("feed.unreachableRetry")}</Text>
      ) : members.length === 0 ? (
        <Text style={styles.empty}>{t("blocked.empty")}</Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.list}>
            {members.map((member, i) => (
              <View key={member.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                <Avatar
                  userId={member.id}
                  name={member.name}
                  url={member.avatarUrl}
                  size={40}
                  placement="blocked"
                  handle={member.handle}
                />
                <View style={styles.rowBody}>
                  <Text style={styles.name} numberOfLines={1}>
                    {member.name}
                  </Text>
                  {member.handle != null && (
                    <Text style={styles.handle} numberOfLines={1}>
                      @{member.handle}
                    </Text>
                  )}
                </View>
                <PressableScale onPress={() => askUnblock(member)} style={styles.pill}>
                  <Text style={styles.pillLabel}>{t("menu.unblock")}</Text>
                </PressableScale>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 44,
      paddingHorizontal: theme.spacing(2),
      marginBottom: theme.spacing(2),
    },
    headerSide: { flex: 1, flexDirection: "row", alignItems: "center" },
    headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    title: {
      flexShrink: 1,
      ...theme.typography.title,
      color: theme.colors.textPrimary,
    },
    loader: { marginTop: theme.spacing(8) },
    empty: {
      ...theme.typography.bodySmall,
      lineHeight: 22,
      color: theme.colors.textFaint,
      textAlign: "center",
      marginTop: theme.spacing(6),
      paddingHorizontal: theme.spacing(4),
    },
    list: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.hairline,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.hairline,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
    },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.hairline },
    rowBody: { flex: 1, gap: 2 },
    name: {
      ...theme.typography.label,
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      color: theme.colors.textPrimary,
    },
    handle: { ...theme.typography.meta, color: theme.colors.textFaint },
    pill: {
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2),
      paddingHorizontal: theme.spacing(4),
    },
    pillLabel: {
      ...theme.typography.meta,
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      color: theme.colors.textPrimary,
    },
  });
}
