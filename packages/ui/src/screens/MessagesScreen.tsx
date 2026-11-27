// The Messages page (validated mockup: tabs; `messaging.hubLayout: "unified"` the
// single list). Direct messages don't exist yet, so only the groups half shows, without
// tabs ("only one of the two modules on"): my groups, latest message first, each with
// its picture (rounded square), the last message, its time and the unread count (grey
// when the group is muted). `tabs` puts "Explore groups" on top, `unified` at the
// bottom. A plain screen: the host pads the top. Renders nothing when groups is off.
import {
  COMMUNITY_EVENTS,
  emitEvent,
  groupsSettings,
  messagingSettings,
  useCommunityConfig,
  useConversations,
  useGroup,
  useMyUid,
  useProfile,
  type Conversation,
} from "@rocapine/community-core";
import { memo, useEffect, useMemo } from "react";
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
import { lastMessagePreview } from "../utils/groups";
import { isQueryLoading } from "../utils/query";
import { formatTimeAgo, useNow } from "../utils/time";

export type MessagesScreenProps = {
  /** The tab to open on, once direct messages exist (ignored until then). */
  initialTab?: "conversations" | "groups";
  onOpenConversation(id: string): void;
  onOpenExplore(): void;
  onBack(): void;
};

export function MessagesScreen(props: MessagesScreenProps) {
  const cfg = useCommunityConfig();
  if (!groupsSettings(cfg)) return null;
  return <Messages {...props} />;
}

function Messages({ onOpenConversation, onOpenExplore, onBack }: MessagesScreenProps) {
  const cfg = useCommunityConfig();
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const unified = messagingSettings(cfg)?.hubLayout === "unified";
  const conversations = useConversations();
  const now = useNow();

  useEffect(() => {
    emitEvent(cfg, COMMUNITY_EVENTS.messagesOpened);
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(
    () =>
      (conversations.data ?? [])
        .filter((c) => c.kind === "group")
        .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")),
    [conversations.data],
  );

  const explore = (
    <Pressable
      onPress={onOpenExplore}
      style={({ pressed }) => [
        unified ? styles.exploreBottom : styles.exploreTop,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
    >
      <icons.search size={16} color={theme.colors.accent} weight="bold" />
      <Text style={styles.exploreLabel}>{t("messages.exploreGroups")}</Text>
    </Pressable>
  );

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
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {t("messages.title")}
        </Text>
      </View>

      {isQueryLoading(conversations) ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
      ) : conversations.isError && !conversations.data ? (
        <Text style={styles.empty}>{t("feed.unreachableRetry")}</Text>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <GroupConversationRow conversation={item} now={now} onPress={onOpenConversation} />
          )}
          ListHeaderComponent={unified ? null : explore}
          ListFooterComponent={unified && groups.length > 0 ? explore : null}
          ListEmptyComponent={
            <View style={styles.emptyBlock}>
              <Text style={styles.empty}>{t("messages.empty")}</Text>
              {unified && explore}
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={conversations.isRefetching}
              onRefresh={() => void conversations.refetch()}
              tintColor={theme.colors.accent}
            />
          }
        />
      )}
    </View>
  );
}

const GroupConversationRow = memo(function GroupConversationRow({
  conversation: c,
  now,
  onPress,
}: {
  conversation: Conversation;
  now: number;
  onPress(id: string): void;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const myUid = useMyUid();
  // The list carries the live title and picture; a group never approved yet has
  // neither, and only its creator holds it: that one row reads the pending values.
  const pending = useGroup(c.title === null && c.kind === "group" ? c.id : null).data;
  const authorId =
    c.lastMessage && c.lastMessage.authorId !== myUid ? c.lastMessage.authorId : null;
  const authorName = useProfile(authorId).data?.name ?? null;
  const name = c.title ?? pending?.name ?? "";
  const preview = lastMessagePreview(c.lastMessage, myUid, authorName, t);
  const unread = c.unread > 0;
  const unreadLabel = unread ? t("messages.unread", { count: c.unread }) : null;

  return (
    <Pressable
      onPress={() => onPress(c.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={[name, preview, unreadLabel].filter(Boolean).join(", ")}
    >
      <Avatar
        userId={null}
        name={name}
        url={c.imageUrl ?? pending?.imageUrl ?? null}
        size={44}
        placement="group"
      />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, unread && styles.strong]} numberOfLines={1}>
            {name}
          </Text>
          {c.groupStatus === "pending" && <Text style={styles.tag}>{t("groups.underReview")}</Text>}
        </View>
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      <View style={styles.rowEnd}>
        {c.lastMessageAt && (
          <Text style={styles.time}>{formatTimeAgo(t, c.lastMessageAt, now)}</Text>
        )}
        {unread && (
          <View style={[styles.count, !c.notify && styles.countMuted]}>
            <Text style={[styles.countLabel, !c.notify && styles.countLabelMuted]}>
              {c.unread > 99 ? "99+" : c.unread}
            </Text>
          </View>
        )}
      </View>
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
    title: { flex: 1, ...theme.typography.title, color: theme.colors.textPrimary },
    loader: { marginTop: theme.spacing(8) },
    emptyBlock: { paddingTop: theme.spacing(6) },
    empty: {
      ...theme.typography.bodySmall,
      color: theme.colors.textFaint,
      textAlign: "center",
      paddingHorizontal: theme.spacing(6),
    },
    pressed: { opacity: 0.7 },
    exploreTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      marginHorizontal: theme.spacing(4),
      marginVertical: theme.spacing(2),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.md,
    },
    exploreBottom: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing(2),
      margin: theme.spacing(4),
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.colors.borderStrong,
    },
    exploreLabel: {
      ...theme.typography.label,
      color: theme.colors.accent,
    },
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
    rowTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
    name: {
      flexShrink: 1,
      ...theme.typography.label,
      color: theme.colors.textPrimary,
    },
    strong: { fontFamily: theme.fonts.bold, fontWeight: theme.fontWeights.bold },
    tag: {
      ...theme.typography.caption,
      color: theme.colors.textSecondary,
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing(1.5),
      overflow: "hidden",
    },
    preview: { ...theme.typography.meta, color: theme.colors.textMuted },
    previewUnread: { color: theme.colors.textSecondary },
    rowEnd: { alignItems: "flex-end", gap: theme.spacing(1) },
    time: { ...theme.typography.caption, color: theme.colors.textFaint },
    count: {
      minWidth: 20,
      height: 20,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing(1.5),
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    countMuted: { backgroundColor: theme.colors.surfaceMuted },
    countLabel: {
      ...theme.typography.caption,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textInverse,
    },
    countLabelMuted: { color: theme.colors.textMuted },
  });
}
