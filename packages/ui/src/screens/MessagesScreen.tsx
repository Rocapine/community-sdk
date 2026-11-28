// The Messages page (validated mockup: tabs; `messaging.hubLayout: "unified"` the
// single list). With groups and dms, "Conversations" (the Requests row on top when
// requests wait, then my DMs: the peer's avatar with its online dot, name, last message,
// time, unread count) and "Groups" (my groups, latest message first, each with its
// picture as a rounded square, the last message, its time and the unread count, grey
// when the group is muted; "Explore groups" on top). `unified` mixes both, Requests on
// top and "Explore groups" at the bottom. With one module, that half without tabs (and
// with dms and the home's "Feed | Groups" selector, groups live there). A plain screen:
// the host pads the top. Renders nothing when no messaging module is on. With
// `dms.entryPoints` holding `"newMessage"`, a pencil over the DMs opens `NewMessageSheet`.
import {
  COMMUNITY_EVENTS,
  dmsSettings,
  emitEvent,
  groupsSettings,
  messagingSettings,
  useCommunityConfig,
  useConversations,
  useDmRequests,
  useGroup,
  useMyUid,
  useProfile,
  type Conversation,
} from "@rocapine/community-core";
import { memo, useEffect, useMemo, useState } from "react";
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
import { SegmentedTabs } from "../components/SegmentedTabs";
import { NewMessageSheet } from "../components/NewMessageSheet";
import { RequestsScreen } from "./RequestsScreen";
import { hubView, showRequestsRow } from "../utils/chat";
import { lastMessagePreview } from "../utils/groups";
import { useMessageMember } from "../utils/messageMember";
import { isQueryLoading } from "../utils/query";
import { formatTimeAgo, useNow } from "../utils/time";

export type MessagesScreenProps = {
  /** The tab to open on (tabs layout, both modules on). Default `"conversations"`. */
  initialTab?: "conversations" | "groups";
  /** Opens a conversation: a group or a DM (also one just started from the pencil). */
  onOpenConversation(id: string): void;
  onOpenExplore(): void;
  /** Opens the DM requests on the host's own route (`RequestsScreen`). Without it, the
   * Requests row opens them inside this screen. */
  onOpenRequests?(): void;
  onBack(): void;
};

type Tab = "conversations" | "groups";

const byLatest = (a: Conversation, b: Conversation) =>
  (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
const unreadOf = (list: Conversation[]) => list.reduce((n, c) => n + c.unread, 0);

export function MessagesScreen(props: MessagesScreenProps) {
  const cfg = useCommunityConfig();
  if (!messagingSettings(cfg)) return null;
  return <Messages {...props} />;
}

function Messages({
  initialTab = "conversations",
  onOpenConversation,
  onOpenExplore,
  onOpenRequests,
  onBack,
}: MessagesScreenProps) {
  const cfg = useCommunityConfig();
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const settings = messagingSettings(cfg)!;
  const view = hubView({
    groups: !!groupsSettings(cfg),
    dms: !!dmsSettings(cfg),
    hubLayout: settings.hubLayout,
    homeLayout: settings.homeLayout,
  });
  const conversations = useConversations();
  const requests = useDmRequests();
  const requestCount = requests.data?.length ?? 0;
  const now = useNow();
  const [tab, setTab] = useState<Tab>(initialTab);
  // The requests shown inside this screen (no `onOpenRequests`).
  const [nested, setNested] = useState(false);
  const [picking, setPicking] = useState(false);
  const messageMember = useMessageMember(({ conversationId }) =>
    onOpenConversation(conversationId),
  );

  useEffect(() => {
    emitEvent(cfg, COMMUNITY_EVENTS.messagesOpened);
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The spinner only answers a pull: a background refetch (back from a chat, a Realtime
  // change) must not show it, or iOS leaves the list pushed down under a stuck spinner.
  const [pulling, setPulling] = useState(false);

  const all = useMemo(() => [...(conversations.data ?? [])].sort(byLatest), [conversations.data]);
  const groups = useMemo(() => all.filter((c) => c.kind === "group"), [all]);
  const dms = useMemo(() => all.filter((c) => c.kind === "dm"), [all]);
  const showGroups = view === "groups" || (view === "tabs" && tab === "groups");
  const data = view === "unified" ? all : showGroups ? groups : dms;
  // Groups alone keep their layout: `unified` puts "Explore groups" at the bottom.
  const exploreAtBottom =
    view === "unified" || (view === "groups" && settings.hubLayout === "unified");

  const explore = (
    <Pressable
      onPress={onOpenExplore}
      style={({ pressed }) => [
        exploreAtBottom ? styles.exploreBottom : styles.exploreTop,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
    >
      <icons.search size={16} color={theme.colors.accent} weight="bold" />
      <Text style={styles.exploreLabel}>{t("messages.exploreGroups")}</Text>
    </Pressable>
  );

  const requestsRow = showRequestsRow(requestCount) ? (
    <Pressable
      onPress={onOpenRequests ?? (() => setNested(true))}
      style={({ pressed }) => [styles.requestsRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${t("messages.requests")}, ${t("dms.requests.pending", { count: requestCount })}`}
    >
      <icons.messages size={18} color={theme.colors.accent} weight="bold" />
      <Text style={styles.requestsLabel} numberOfLines={1}>
        {t("messages.requests")}
      </Text>
      <View style={styles.count}>
        <Text style={styles.countLabel}>{requestCount > 99 ? "99+" : requestCount}</Text>
      </View>
    </Pressable>
  ) : null;

  const header = showGroups ? (exploreAtBottom ? null : explore) : requestsRow;
  const newMessage = !showGroups && !!dmsSettings(cfg)?.entryPoints.includes("newMessage");

  if (nested)
    return (
      <RequestsScreen
        onOpenRequest={onOpenConversation}
        onBack={() => {
          setNested(false);
          void requests.refetch();
        }}
      />
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
        {newMessage && (
          <Pressable
            onPress={() =>
              messageMember.accountMissing ? cfg.host.onAccountRequired?.("dm") : setPicking(true)
            }
            disabled={messageMember.pending}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={t("dms.new.title")}
          >
            <icons.compose size={22} color={theme.colors.textPrimary} weight="regular" />
          </Pressable>
        )}
      </View>

      {view === "tabs" && (
        <SegmentedTabs<Tab>
          items={[
            {
              key: "conversations",
              label: t("messages.tabs.conversations"),
              // Unread messages; requests have their own row.
              count: unreadOf(dms),
            },
            {
              key: "groups",
              label: t("groups.home.groups"),
              // A muted group doesn't count.
              count: unreadOf(groups.filter((c) => c.notify)),
            },
          ]}
          selected={tab}
          onSelect={setTab}
          style={styles.segments}
        />
      )}

      {isQueryLoading(conversations) ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
      ) : conversations.isError && !conversations.data ? (
        <Text style={styles.empty}>{t("feed.unreachableRetry")}</Text>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) =>
            item.kind === "dm" ? (
              <DmConversationRow conversation={item} now={now} onPress={onOpenConversation} />
            ) : (
              <GroupConversationRow conversation={item} now={now} onPress={onOpenConversation} />
            )
          }
          ListHeaderComponent={header}
          ListFooterComponent={exploreAtBottom && data.length > 0 ? explore : null}
          ListEmptyComponent={
            <View style={styles.emptyBlock}>
              <Text style={styles.empty}>{t(showGroups ? "messages.empty" : "dms.empty")}</Text>
              {exploreAtBottom && explore}
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                void Promise.all([conversations.refetch(), requests.refetch()]).finally(() =>
                  setPulling(false),
                );
              }}
              tintColor={theme.colors.accent}
            />
          }
        />
      )}
      {newMessage && (
        <NewMessageSheet
          visible={picking}
          onClose={() => setPicking(false)}
          onPick={(memberId) => messageMember.message(memberId, "newMessage")}
        />
      )}
    </View>
  );
}

/** A row's right side: the last message's time and the unread count (grey when muted). */
function RowEnd({ c, now }: { c: Conversation; now: number }) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.rowEnd}>
      {c.lastMessageAt && <Text style={styles.time}>{formatTimeAgo(t, c.lastMessageAt, now)}</Text>}
      {c.unread > 0 && (
        <View style={[styles.count, !c.notify && styles.countMuted]}>
          <Text style={[styles.countLabel, !c.notify && styles.countLabelMuted]}>
            {c.unread > 99 ? "99+" : c.unread}
          </Text>
        </View>
      )}
    </View>
  );
}

/** One of my DMs: the peer's avatar (online dot), name, last message, time and unread
 * count. Across a block the list has no peer: "Blocked member", no picture. */
const DmConversationRow = memo(function DmConversationRow({
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
  const peer = useProfile(c.peerId).data;
  const name = peer?.name ?? (c.peerId ? "" : t("dms.blockedMember"));
  const preview = lastMessagePreview(c.lastMessage, myUid, null, t, true);
  // DMs are always followed: their count never greys.
  const row = { ...c, notify: true };
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
        userId={c.peerId}
        name={name}
        url={peer?.avatarUrl ?? null}
        size={44}
        placement="dm"
        admin={peer?.admin ?? false}
        handle={peer?.handle ?? null}
        badges={peer?.badges}
      />
      <View style={styles.rowBody}>
        <Text style={[styles.name, unread && styles.strong]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      <RowEnd c={row} now={now} />
    </Pressable>
  );
});

/** One of my groups: picture, name, last message, time and unread count (grey when muted). */
export const GroupConversationRow = memo(function GroupConversationRow({
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
          {(c.groupStatus ?? pending?.status) === "pending" && (
            <Text style={styles.tag}>{t("groups.underReview")}</Text>
          )}
        </View>
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      <RowEnd c={c} now={now} />
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
    requestsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2.5),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3.5),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.hairline,
    },
    requestsLabel: {
      flex: 1,
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textPrimary,
    },
    segments: {
      marginHorizontal: theme.spacing(4),
      marginTop: theme.spacing(1),
      marginBottom: theme.spacing(2),
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
