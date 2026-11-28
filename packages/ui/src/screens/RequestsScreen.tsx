// DM requests waiting for my answer (dms module, validated mockup B: a list, then the
// conversation): each sender's avatar, name, last message and time, newest first, under
// the reminder that senders don't know I read them. Tapping one opens it read-only
// (`ConversationScreen`), where I accept, decline or block. A plain screen: the host
// pads the top. Renders nothing when dms is off.
import {
  dmsSettings,
  useCommunityConfig,
  useDmRequests,
  useProfile,
  type DmRequest,
} from "@rocapine/community-core";
import { memo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { Avatar } from "../components/Avatar";
import { ScreenBackground } from "../components/ScreenBackground";
import { isQueryLoading } from "../utils/query";
import { formatTimeAgo, useNow } from "../utils/time";

export type RequestsScreenProps = {
  onOpenRequest(conversationId: string): void;
  onBack(): void;
};

export function RequestsScreen(props: RequestsScreenProps) {
  const cfg = useCommunityConfig();
  if (!dmsSettings(cfg)) return null;
  return <Requests {...props} />;
}

function Requests({ onOpenRequest, onBack }: RequestsScreenProps) {
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const requests = useDmRequests();
  const count = requests.data?.length ?? 0;
  const now = useNow();
  // The spinner only answers a pull (see MessagesScreen).
  const [pulling, setPulling] = useState(false);

  return (
    <View style={styles.root}>
      <ScreenBackground />
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.back")}
        >
          <icons.back size={22} color={theme.colors.textPrimary} weight="bold" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {t("dms.requests.title")}
          </Text>
          {count > 0 && <Text style={styles.subtitle}>{t("dms.requests.pending", { count })}</Text>}
        </View>
      </View>

      {isQueryLoading(requests) ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
      ) : requests.isError && !requests.data ? (
        <Text style={styles.empty}>{t("feed.unreachableRetry")}</Text>
      ) : (
        <FlatList
          data={requests.data ?? []}
          keyExtractor={(r) => r.conversationId}
          renderItem={({ item }) => <RequestRow request={item} now={now} onPress={onOpenRequest} />}
          ListHeaderComponent={
            count > 0 ? <Text style={styles.hint}>{t("dms.requests.hint")}</Text> : null
          }
          ListEmptyComponent={<Text style={styles.emptyList}>{t("dms.requests.empty")}</Text>}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                void requests.refetch().finally(() => setPulling(false));
              }}
              tintColor={theme.colors.accent}
            />
          }
        />
      )}
    </View>
  );
}

const RequestRow = memo(function RequestRow({
  request: r,
  now,
  onPress,
}: {
  request: DmRequest;
  now: number;
  onPress(conversationId: string): void;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const sender = useProfile(r.senderId).data;
  const name = sender?.name ?? "";
  const preview = r.lastBody ? r.lastBody.replace(/\s+/g, " ").trim() : t("image.photo");
  return (
    <Pressable
      onPress={() => onPress(r.conversationId)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${preview}`}
    >
      <Avatar
        userId={r.senderId}
        name={name}
        url={sender?.avatarUrl ?? null}
        size={44}
        placement="dm"
        admin={sender?.admin ?? false}
        handle={sender?.handle ?? null}
        badges={sender?.badges}
      />
      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      <Text style={styles.time}>{formatTimeAgo(t, r.lastAt, now)}</Text>
    </Pressable>
  );
});

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 52,
      paddingHorizontal: theme.spacing(1),
      gap: theme.spacing(1),
    },
    headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    headerText: { flex: 1 },
    title: { ...theme.typography.title, color: theme.colors.textPrimary },
    subtitle: { ...theme.typography.caption, color: theme.colors.textMuted },
    loader: { marginTop: theme.spacing(8) },
    hint: {
      ...theme.typography.meta,
      color: theme.colors.textMuted,
      marginHorizontal: theme.spacing(4),
      marginVertical: theme.spacing(2),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    empty: {
      ...theme.typography.bodySmall,
      color: theme.colors.textFaint,
      textAlign: "center",
      paddingHorizontal: theme.spacing(6),
    },
    emptyList: {
      ...theme.typography.bodySmall,
      color: theme.colors.textFaint,
      textAlign: "center",
      paddingHorizontal: theme.spacing(6),
      paddingTop: theme.spacing(6),
    },
    pressed: { opacity: 0.7 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.hairline,
    },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    name: {
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textPrimary,
    },
    preview: { ...theme.typography.meta, color: theme.colors.textSecondary },
    time: { ...theme.typography.caption, color: theme.colors.textFaint },
  });
}
