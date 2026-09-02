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
//    ?.trim() || "Eve's Rhythm" })`) is dropped along with the branding: this
//    package's `inbox.someone` catalog key ("Someone") is the fallback for
//    every kind here, official posts included — a host wanting a branded
//    fallback supplies it via `translations.overrides`.
//  - Only the 4 standard kinds (`like`/`comment`/`reaction`/`official_post`)
//    get a built-in row; anything else calls `renderInboxRow?.(item, null)`
//    (mirrors `PostSlots`' `renderPostFooter?.(post, defaults) ?? defaults`
//    pattern from `CommunityPost`, except the fallback here is `null` since
//    there is no built-in row for an unknown kind to fall back to).
//  - Eve's continuous re-mark-as-seen while the screen stays open (its own
//    effect re-fires `markSeen.mutate(latest)` whenever a newer item lands)
//    is not ported: this package's `markInboxSeen(cfg)` (Task 5) takes no
//    "latest item" argument — it resolves its own clock-skew-safe anchor
//    internally — and the brief's contract is the simpler "marks seen on
//    mount", not a continuous watch. Mirrors this package's own
//    `CommunityFeedScreen`, whose new-post polling likewise doesn't
//    reconcile a "seen" marker mid-visit.
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
  useMarkInboxSeen,
  useNotificationInbox,
  type InboxItem,
} from "@rocapine/community-core";
import * as Haptics from "expo-haptics";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TFn } from "../i18n";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { isQueryLoading } from "../utils/query";
import { formatTimeAgo } from "../utils/time";

const KNOWN_KINDS = new Set<InboxItem["kind"]>(["like", "comment", "reaction", "official_post"]);

export function NotificationInboxScreen({
  onOpenPost,
  renderInboxRow,
}: {
  onOpenPost(postId: string): void;
  renderInboxRow?: (item: InboxItem, defaults: ReactNode | null) => ReactNode;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);

  const inbox = useNotificationInbox();
  const markSeen = useMarkInboxSeen();

  // Freeze the pre-open seen marker (undefined = "not frozen yet", distinct
  // from a frozen `null` meaning "never opened before") so unread dots stay
  // stable for this visit even after the optimistic mark-seen below clears
  // the cache's `seenAt`. See file header for the emit-before-mutate ordering.
  const [frozenSeenAt, setFrozenSeenAt] = useState<string | null | undefined>(undefined);
  const opened = useRef(false);
  useEffect(() => {
    if (!inbox.data || opened.current) return;
    opened.current = true;
    setFrozenSeenAt(inbox.data.seenAt);
    emitEvent(cfg, COMMUNITY_EVENTS.inboxOpened, {
      unread_count: unreadCount(inbox.data.items, inbox.data.seenAt),
    });
    markSeen.mutate();
    // Fires once, off the first successful fetch; intentionally not re-run as
    // `cfg`/`markSeen`'s identity changes underneath an already-open screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox.data]);

  const items = inbox.data?.items ?? [];
  const seenAt = frozenSeenAt !== undefined ? frozenSeenAt : (inbox.data?.seenAt ?? null);
  const seenMs = seenAt ? Date.parse(seenAt) : 0;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t("inbox.title")}</Text>

      {isQueryLoading(inbox) ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{t("inbox.empty")}</Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            {items.map((item, i) => {
              const defaultRow = KNOWN_KINDS.has(item.kind) ? (
                <NotificationRow
                  item={item}
                  unread={Date.parse(item.createdAt) > seenMs}
                  showDivider={i > 0}
                  onOpenPost={onOpenPost}
                />
              ) : null;
              return (
                <Fragment key={item.id}>
                  {renderInboxRow ? renderInboxRow(item, defaultRow) : defaultRow}
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
    case "reaction":
      return <icons.reaction size={19} color={color} weight="fill" />;
    case "official_post":
      return <icons.announcement size={19} color={color} weight="fill" />;
    default:
      return null;
  }
}

function rowTitle(t: TFn, item: InboxItem): string {
  const name = item.actorName?.trim() || t("inbox.someone");
  switch (item.kind) {
    case "like":
      return t("inbox.liked", { name });
    case "comment":
      return t("inbox.commented", { name });
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
  onOpenPost,
}: {
  item: InboxItem;
  unread: boolean;
  showDivider: boolean;
  onOpenPost(postId: string): void;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const excerpt = typeof item.payload.postExcerpt === "string" ? item.payload.postExcerpt : null;

  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        if (item.postId) onOpenPost(item.postId);
      }}
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
    root: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing(5) },
    title: {
      fontFamily: theme.fonts.serifBold,
      fontSize: 26,
      color: theme.colors.textPrimary,
      marginBottom: theme.spacing(5),
    },
    loader: { marginTop: theme.spacing(8) },
    empty: {
      fontFamily: theme.fonts.regular,
      fontSize: 14,
      lineHeight: 22,
      color: theme.colors.textFaint,
      textAlign: "center",
      marginTop: theme.spacing(6),
      paddingHorizontal: theme.spacing(4),
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3.5),
    },
    rowDivider: { borderTopWidth: 1, borderTopColor: theme.colors.hairline },
    rowPressed: { opacity: 0.8 },
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
      fontSize: 14.5,
      lineHeight: 20,
      color: theme.colors.textSecondary,
    },
    rowTitleUnread: { fontFamily: theme.fonts.bold, color: theme.colors.textPrimary },
    rowExcerpt: {
      fontFamily: theme.fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: theme.colors.textFaint,
    },
    rowMeta: { alignItems: "flex-end", gap: theme.spacing(1.5), marginTop: 2 },
    rowDate: { fontFamily: theme.fonts.medium, fontSize: 12, color: theme.colors.textFaint },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent },
  });
}
