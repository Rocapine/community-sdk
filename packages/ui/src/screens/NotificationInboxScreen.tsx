// Server-event notification center: likes, comments, reactions and official
// posts on the viewer's own content. Ported from Eve's Rhythm's
// `NotificationsScreen` (`app/(app)/notifications.tsx`), rebuilt on this
// package's `CommunitySheet`-free plain screen pattern (`ProfileScreen`'s own
// header-less body, since this screen's brief signature has no `onBack`).
//
// Router-free / host-decoupling transformations (task brief):
//  - `router.push("/community")` / `router.push("/support", ...)` -> the
//    single `onOpenPost(postId)` callback, called only when a row's
//    `postId` is present (the brief's own contract). Eve's `support_reply`
//    kind is NOT ported (task brief: "Eve's support_reply special-casing
//    must NOT be ported — the custom-kind slot covers it") — a host that
//    still has that kind flowing through its inbox rows gets it back via
//    `renderInboxRow`, with `defaults` as `null` (an unrecognized kind), and
//    builds its own tap target (e.g. its own support route) there.
//  - Eve's `"Eve's Rhythm"` brand-name fallback on `official_post` rows (that
//    source's `translate("community.inbox.news", { name: n.actorUsername
//    ?.trim() || "Eve's Rhythm" })`) becomes the full-sentence
//    `inbox.newsFromTeam` key ("News from the team"; a host puts its app name
//    there via `translations.overrides`). Other kinds fall back to
//    `inbox.someone`.
//  - A row with no `postId` (e.g. an announcement whose post is gone) calls
//    the optional `onOpenCommunity` instead of doing nothing (Eve source sent
//    every row to the community tab).
//  - Only the 4 standard kinds (`like`/`comment`/`reaction`/`official_post`)
//    get a built-in row; anything else calls `renderInboxRow?.(item, null)`
//    (mirrors `PostSlots`' `renderPostFooter?.(post, defaults) ?? defaults`
//    pattern from `CommunityPost`, except the fallback here is `null` since
//    there is no built-in row for an unknown kind to fall back to).
//  - Marks seen on open, and again whenever a newer item lands while the
//    screen stays open (Eve source did the same), so an arrival mid-visit
//    doesn't relight the host's unread badge after leaving. `markInboxSeen`
//    resolves its own clock-skew-safe anchor, so re-calling it is enough.
//
// `unread_count` on the `inboxOpened` event (and the unread dots below) is
// computed from the inbox's pre-open seen marker, snapshotted the first time
// data loads and kept steady for the rest of this visit — otherwise the
// optimistic `markInboxSeen` mutation (which moves `seenAt` to "now" in the
// cache) would zero the count and un-dot every row the instant the effect
// that reports it also fires the mark-seen mutation. The event is emitted
// (reading the live, still-unmutated cache) strictly before `markSeen.mutate()`
// is called, so it always reports the count as it stood on open — never the
// post-mutation cleared state.

import {
  COMMUNITY_EVENTS,
  emitEvent,
  unreadCount,
  useCommunityConfig,
  isUnread,
  useMarkInboxItemRead,
  useMarkInboxSeen,
  useNotificationInbox,
  type InboxItem,
} from "@rocapine/community-core";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TFn } from "../i18n";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { inboxExcerpt } from "../utils/postImage";
import { isQueryLoading } from "../utils/query";
import { formatTimeAgo } from "../utils/time";

const KNOWN_KINDS = new Set<InboxItem["kind"]>([
  "like",
  "comment",
  "reply",
  "reaction",
  "official_post",
]);

export function NotificationInboxScreen({
  onOpenPost,
  onOpenCommunity,
  onBack,
  renderInboxRow,
}: {
  onOpenPost(postId: string): void;
  /** Shows a back button left of the centred title. */
  onBack?: () => void;
  /** Tapped row with no post attached (e.g. a deleted announcement). */
  onOpenCommunity?: () => void;
  /** Custom row renderer. `defaults` is the built-in row (or `null` for a
   * kind the SDK doesn't know); `meta.unread` is the same "newer than the
   * pre-open seen marker" flag the built-in rows use for their dot, so a host
   * row for a custom kind can style unread state identically. */
  renderInboxRow?: (
    item: InboxItem,
    defaults: ReactNode | null,
    meta: { unread: boolean },
  ) => ReactNode;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);

  const icons = useCommunityIcons();
  const inbox = useNotificationInbox();
  const markSeen = useMarkInboxSeen();
  const markItemRead = useMarkInboxItemRead();
  // "open": opening the center reads everything (unread dots frozen for the
  // visit). "tap": an item is read once tapped; "mark all as read" in the header.
  const tapToRead = cfg.inboxReadMode === "tap";

  // Freeze the pre-open seen marker (undefined = "not frozen yet", distinct
  // from a frozen `null` meaning "never opened before") so unread dots stay
  // stable for this visit even after the optimistic mark-seen below clears
  // the cache's `seenAt`. See file header for the emit-before-mutate ordering.
  const [frozenSeenAt, setFrozenSeenAt] = useState<string | null | undefined>(undefined);
  const opened = useRef(false);
  // Newest item already marked seen during this visit.
  const latestSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!inbox.data) return;
    const newest = inbox.data.items[0]?.createdAt ?? null;
    if (opened.current) {
      if (tapToRead) return;
      if (newest && (!latestSeen.current || newest > latestSeen.current)) {
        latestSeen.current = newest;
        markSeen.mutate();
      }
      return;
    }
    opened.current = true;
    latestSeen.current = newest;
    emitEvent(cfg, COMMUNITY_EVENTS.inboxOpened, {
      unread_count: unreadCount(inbox.data.items, inbox.data.seenAt, inbox.data.readIds),
    });
    if (tapToRead) return;
    setFrozenSeenAt(inbox.data.seenAt);
    markSeen.mutate();
    // Fires once, off the first successful fetch; intentionally not re-run as
    // `cfg`/`markSeen`'s identity changes underneath an already-open screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox.data]);

  const items = inbox.data?.items ?? [];
  const seenAt = frozenSeenAt !== undefined ? frozenSeenAt : (inbox.data?.seenAt ?? null);
  // Live in "tap" mode (dots go out as items are read); frozen per visit in "open".
  const readIds = tapToRead ? (inbox.data?.readIds ?? []) : [];
  const anyUnread = items.some((item) => isUnread(item, seenAt, readIds));
  const openItem = (item: InboxItem) => {
    if (tapToRead && isUnread(item, seenAt, readIds)) markItemRead.mutate(item.id);
    if (item.postId) onOpenPost(item.postId);
    else onOpenCommunity?.();
  };

  return (
    <View style={styles.root}>
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
          {t("inbox.title")}
        </Text>
        <View style={[styles.headerSide, styles.headerSideRight]}>
          {tapToRead && anyUnread && (
            <Pressable
              onPress={() => markSeen.mutate()}
              style={styles.headerButton}
              accessibilityRole="button"
              accessibilityLabel={t("inbox.markAllRead")}
            >
              <icons.markAllRead size={22} color={theme.colors.accent} weight="regular" />
            </Pressable>
          )}
        </View>
      </View>

      {isQueryLoading(inbox) ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{t("inbox.empty")}</Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.list}>
            {items.map((item, i) => {
              const unread = isUnread(item, seenAt, readIds);
              const defaultRow = KNOWN_KINDS.has(item.kind) ? (
                <NotificationRow
                  item={item}
                  unread={unread}
                  showDivider={i > 0}
                  onPress={() => openItem(item)}
                />
              ) : null;
              return (
                <Fragment key={item.id}>
                  {renderInboxRow ? renderInboxRow(item, defaultRow, { unread }) : defaultRow}
                </Fragment>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function KindIcon({ kind }: { kind: InboxItem["kind"] }) {
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const color = theme.colors.accent;
  switch (kind) {
    case "like":
      return <icons.like size={19} color={color} weight="fill" />;
    case "comment":
      return <icons.comment size={19} color={color} weight="fill" />;
    case "reply":
      return <icons.reply size={19} color={color} weight="fill" />;
    case "reaction":
      return <icons.reaction size={19} color={color} weight="fill" />;
    case "official_post":
      return <icons.announcement size={19} color={color} weight="fill" />;
    default:
      return null;
  }
}

function rowTitle(t: TFn, item: InboxItem): string {
  const actor = item.actorName?.trim();
  // An announcement with no named author reads "News from the team" (a host
  // overrides `inbox.newsFromTeam` with its own name), not "from Someone".
  if (item.kind === "official_post" && !actor) return t("inbox.newsFromTeam");
  const name = actor || t("inbox.someone");
  switch (item.kind) {
    case "like":
      return t("inbox.liked", { name });
    case "comment":
      return t("inbox.commented", { name });
    case "reply":
      return t("inbox.replied", { name });
    case "reaction":
      return t("inbox.reacted", { name });
    case "official_post":
      return t("inbox.news", { name });
    default:
      return "";
  }
}

function NotificationRow({
  item,
  unread,
  showDivider,
  onPress,
}: {
  item: InboxItem;
  unread: boolean;
  showDivider: boolean;
  onPress(): void;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const excerpt = inboxExcerpt(item.payload.postExcerpt, t);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.iconWrap}>
        <KindIcon kind={item.kind} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={2}>
          {rowTitle(t, item)}
        </Text>
        {excerpt ? (
          <Text style={styles.rowExcerpt} numberOfLines={2}>
            {excerpt}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.rowDate}>{formatTimeAgo(t, item.createdAt, Date.now())}</Text>
        {unread && <View style={styles.unreadDot} />}
      </View>
    </Pressable>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    // Back button · centred title · "mark all as read"; both sides flex
    // equally so the title stays centred.
    header: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 44,
      paddingHorizontal: theme.spacing(2),
      marginBottom: theme.spacing(2),
    },
    headerSide: { flex: 1, flexDirection: "row", alignItems: "center" },
    headerSideRight: { justifyContent: "flex-end" },
    headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    title: {
      flexShrink: 1,
      fontFamily: theme.fonts.serifBold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 19,
      color: theme.colors.textPrimary,
    },
    loader: { marginTop: theme.spacing(8) },
    empty: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 14,
      lineHeight: 22,
      color: theme.colors.textFaint,
      textAlign: "center",
      marginTop: theme.spacing(6),
      paddingHorizontal: theme.spacing(4),
    },
    // Flat rows edge to edge, as in the feed: out of the screen padding,
    // hairlines between them.
    list: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.hairline,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.hairline,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3.5),
    },
    // A tint, not a scale: rows sit edge to edge.
    rowPressed: { backgroundColor: theme.colors.hairline },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.hairline },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      marginTop: 2,
    },
    rowBody: { flex: 1, gap: 3 },
    rowTitle: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 14.5,
      lineHeight: 20,
      color: theme.colors.textSecondary,
    },
    rowTitleUnread: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textPrimary,
    },
    rowExcerpt: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 13,
      lineHeight: 18,
      color: theme.colors.textFaint,
    },
    rowMeta: { alignItems: "flex-end", gap: theme.spacing(1.5), marginTop: 2 },
    rowDate: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 12,
      color: theme.colors.textFaint,
    },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent },
  });
}
