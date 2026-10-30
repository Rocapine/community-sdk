// A community member's public profile: header (avatar/handle/bio/official
// seal), their posts (via `CommunityPost`, so it shares the feed's like/
// reaction/comment/menu footer and poll block), an edit affordance on one's
// own profile, and a block/report menu on someone else's. Ported from the
// mold's `UserProfileScreen` (`sdk/client/app/user/[id].tsx`).
//
// Router-free transformations (task brief):
//  - `useLocalSearchParams<{ id, source }>()` -> the `userId` and optional
//    `source` props. `source` is what `onOpenProfile(userId, source)` reported
//    (`"post"`/`"comment"`); `profileOpened` sends `"self"` on one's own
//    profile, else `source` (default `"post"`) — see the effect below.
//  - `router.back()` -> the optional `onBack` prop (also fired after a
//    successful self-block from the header menu, same as the mold's
//    `router.back()` there).
//  - `router.push(/user/...)` doesn't apply: `CommunityPost`'s
//    `onOpenProfile` is wired to a no-op on this screen — every post rendered
//    here is already authored by `userId`, so tapping its avatar/name would
//    just reopen the same profile.
//
// Differences from the mold, beyond the standard reconciliation:
//  - No owned `CommunityThread`/comment composer: the brief's signature takes
//    `onOpenThread(postId)` instead of the mold's own thread state
//    (`activePost`/`useThread`/`addComment`), so opening a post here is
//    entirely the host's concern (e.g. routing into `ThreadSheet` alongside
//    `CommunityFeedScreen`'s own instance) — this screen never renders a
//    thread sheet itself. That also means no comment-rejection `NoticeCard`
//    here (the mold's only use of one on this screen was for a comment
//    submitted from its own thread sheet, which no longer exists here);
//    report/block outcomes surface through `ReportSheet`'s own `Alert`s, same
//    as `CommunityFeedScreen`.
//  - `useUserPosts` is an infinite query, paginated like the feed (product
//    decision, reversing the earlier single-page scope cut): this screen
//    keeps its `ScrollView` (the header/avatar/bio content above the post
//    list has no natural `FlatList` home) and mirrors `CommunityFeedScreen`'s
//    guarded `loadMore` with a "Load more" footer button instead of
//    switching to `FlatList`.
//  - `ProfileEditSheet` no longer takes a `profile` prop (Task 13 signature:
//    `{ visible, onClose }` — it resolves its own identity/profile), so it's
//    mounted here without one.
//  - No shared `nowMs` prop: `CommunityPost` reads the shared once-a-minute
//    clock (`useNow`) itself.

import {
  COMMUNITY_EVENTS,
  emitEvent,
  useBlockUser,
  useCommunityConfig,
  useDeleteContent,
  useMyUid,
  useProfile,
  useUserPosts,
  type FeedPost,
  streakDays,
} from "@rocapine/community-core";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { CommunityPost, type PostSlots, type ProfileSource } from "../components/CommunityPost";
import { Avatar } from "../components/Avatar";
import { ImageViewerHost } from "../components/ImageViewer";
import { ReportSheet, type ReportTarget } from "../components/ReportSheet";
import { PressableScale } from "../components/PressableScale";
import { StreakPill } from "../components/StreakPill";
import { isQueryLoading } from "../utils/query";
import { ProfileEditSheet } from "./ProfileEditSheet";

// Every post rendered on this screen already belongs to `userId` — see file
// header. Reusing this for `onOpenProfile` avoids a self-navigating tap.
const noop = () => {};

export function ProfileScreen({
  userId,
  source = "post",
  onOpenThread,
  onBack,
  onPressTopic,
  slots,
  topInset = 0,
}: {
  userId: string;
  /** Where the visit came from (see `onOpenProfile`'s second argument), for
   * the `profileOpened` event. */
  source?: ProfileSource;
  /** `focusComment`: opened from the post's comment button — open the
   * thread with the reply field focused (`ThreadSheet`'s `focusComment`). */
  onOpenThread(postId: string, focusComment?: boolean): void;
  onBack?: () => void;
  /** A post's topic was tapped: the host takes the user back to its feed on
   * that topic (see `CommunityFeedScreen`'s `topicRequest`). Absent: topics
   * are not tappable here. */
  onPressTopic?(topicId: string): void;
  slots?: PostSlots;
  // Top safe-area inset in px. This screen owns its back button and is meant
  // to be mounted as a full-screen route, so on a notched device the host
  // must feed `useSafeAreaInsets().top` here — the SDK deliberately takes no
  // react-native-safe-area-context dependency of its own (see Sheet.tsx).
  topInset?: number;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);

  const myUid = useMyUid();
  const isMe = myUid != null && myUid === userId;
  const profile = useProfile(userId);
  const userPosts = useUserPosts(userId);

  const blockUser = useBlockUser();
  const deleteContent = useDeleteContent();

  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  // Spinner only for a pull, never for a background refetch.
  const [pulling, setPulling] = useState(false);

  // Fires once, but only once identity has actually resolved: `useMyUid`'s
  // query is uncached on a session's first profile visit, so `myUid` is null
  // on that very first render and a mount-time read would always see `isMe`
  // as false, mislabeling a visit to one's own profile. The once-guard
  // (rather than an empty dep array) lets the effect wait for `myUid` to
  // settle without risking a duplicate fire once it does.
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current || myUid === null) return;
    tracked.current = true;
    emitEvent(cfg, COMMUNITY_EVENTS.profileOpened, { source: isMe ? "self" : source });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid, isMe]);

  const posts = userPosts.data?.pages.flat() ?? [];
  const hasNextPage = !!userPosts.hasNextPage;
  const isFetchingNextPage = userPosts.isFetchingNextPage;
  const loadMore = () => {
    if (userPosts.hasNextPage && !userPosts.isFetchingNextPage) userPosts.fetchNextPage();
  };

  const openPostMenu = (post: FeedPost) => {
    if (post.isOwn) {
      Alert.alert(t("menu.deletePostTitle"), t("menu.deletePostBody"), [
        { text: t("menu.cancel"), style: "cancel" },
        {
          text: t("menu.delete"),
          style: "destructive",
          onPress: () => deleteContent.mutate({ kind: "post", id: post.id, postId: post.id }),
        },
      ]);
      return;
    }
    Alert.alert(post.authorName, undefined, [
      {
        text: t("menu.reportPost"),
        onPress: () => setReportTarget({ kind: "post", id: post.id, authorId: post.authorId }),
      },
      {
        text: t("menu.blockUser", { name: post.authorName }),
        style: "destructive",
        onPress: () =>
          Alert.alert(
            t("menu.blockUserConfirmTitle", { name: post.authorName }),
            t("menu.blockUserConfirmBody"),
            [
              { text: t("menu.cancel"), style: "cancel" },
              {
                text: t("menu.block"),
                style: "destructive",
                onPress: () => blockUser.mutate({ userId: post.authorId }),
              },
            ],
          ),
      },
      { text: t("menu.cancel"), style: "cancel" },
    ]);
  };

  const openHeaderMenu = () => {
    if (!profile.data) return;
    const targetName = profile.data.name;
    Alert.alert(targetName, undefined, [
      {
        text: t("menu.blockUser", { name: targetName }),
        style: "destructive",
        onPress: () =>
          Alert.alert(
            t("menu.blockUserConfirmTitle", { name: targetName }),
            t("menu.blockUserConfirmBody"),
            [
              { text: t("menu.cancel"), style: "cancel" },
              {
                text: t("menu.block"),
                style: "destructive",
                onPress: () => blockUser.mutate({ userId }, { onSuccess: () => onBack?.() }),
              },
            ],
          ),
      },
      { text: t("menu.cancel"), style: "cancel" },
    ]);
  };

  return (
    <ImageViewerHost>
      <View style={styles.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            topInset > 0 ? { paddingTop: topInset + theme.spacing(2) } : null,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                Promise.all([profile.refetch(), userPosts.refetch()]).finally(() =>
                  setPulling(false),
                );
              }}
              tintColor={theme.colors.accent}
            />
          }
        >
          <View style={styles.topRow}>
            {onBack ? (
              <Pressable
                onPress={onBack}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel={t("a11y.back")}
              >
                <icons.back size={22} color={theme.colors.textPrimary} weight="bold" />
              </Pressable>
            ) : (
              <View style={styles.topRowSpacer} />
            )}
            <View style={styles.topRowSpacer} />
            {myUid != null && !isMe && (
              <Pressable
                onPress={openHeaderMenu}
                style={styles.dotsBtn}
                accessibilityRole="button"
                accessibilityLabel={t("a11y.more")}
              >
                <icons.menu size={22} color={theme.colors.textPrimary} weight="bold" />
              </Pressable>
            )}
          </View>

          {isQueryLoading(profile) ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
          ) : profile.isError || !profile.data ? (
            <Text style={styles.stateText}>{t("feed.unreachable")}</Text>
          ) : (
            <>
              <View style={styles.header}>
                <View style={styles.avatar}>
                  <Avatar
                    userId={userId}
                    name={profile.data.name}
                    url={profile.data.avatarUrl}
                    size={72}
                  />
                </View>
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{profile.data.name}</Text>
                  {profile.data.official && (
                    <icons.officialSeal size={17} color={theme.colors.official} weight="fill" />
                  )}
                </View>
                {profile.data.handle != null && (
                  <Text style={styles.handle}>@{profile.data.handle}</Text>
                )}
                {profile.data.bio ? <Text style={styles.bio}>{profile.data.bio}</Text> : null}
                {cfg.modules.streaks && (
                  <View style={styles.streaks}>
                    {profile.data.streakStartedAt != null &&
                      streakDays(profile.data.streakStartedAt) >= 1 && (
                        <View style={styles.streakStat}>
                          <StreakPill
                            size="large"
                            days={streakDays(profile.data.streakStartedAt)}
                          />
                          <Text style={styles.streakLabel}>{t("profile.streak")}</Text>
                        </View>
                      )}
                    {profile.data.bestStreakDays != null && profile.data.bestStreakDays >= 1 && (
                      <View style={styles.streakStat}>
                        <StreakPill size="large" days={profile.data.bestStreakDays} />
                        <Text style={styles.streakLabel}>{t("profile.bestStreak")}</Text>
                      </View>
                    )}
                  </View>
                )}
                {isMe && (
                  <PressableScale onPress={() => setEditOpen(true)} style={styles.editPill}>
                    <Text style={styles.editPillLabel}>{t("profile.editProfile")}</Text>
                  </PressableScale>
                )}
              </View>

              <Text style={styles.sectionLabel}>{t("profile.postsSection")}</Text>
              <View style={styles.feed}>
                {isQueryLoading(userPosts) ? (
                  <ActivityIndicator color={theme.colors.accent} style={styles.spinnerSmall} />
                ) : userPosts.isError ? (
                  <Text style={styles.stateText}>{t("feed.unreachableRetry")}</Text>
                ) : posts.length === 0 ? (
                  <Text style={styles.stateText}>
                    {isMe ? t("profile.emptyOwn") : t("profile.emptyOther")}
                  </Text>
                ) : (
                  posts.map((post) => (
                    <View key={post.id} style={styles.row}>
                      <CommunityPost
                        post={post}
                        onOpenThread={onOpenThread}
                        onPressComment={(postId) => onOpenThread(postId, true)}
                        onOpenProfile={noop}
                        onMenu={openPostMenu}
                        onPressTopic={onPressTopic}
                        {...slots}
                      />
                    </View>
                  ))
                )}
                {hasNextPage && (
                  <PressableScale onPress={loadMore} style={styles.loadMore}>
                    {isFetchingNextPage ? (
                      <ActivityIndicator size="small" color={theme.colors.accent} />
                    ) : (
                      <Text style={styles.loadMoreText}>{t("feed.loadMore")}</Text>
                    )}
                  </PressableScale>
                )}
              </View>
            </>
          )}
        </ScrollView>

        {isMe && <ProfileEditSheet visible={editOpen} onClose={() => setEditOpen(false)} />}
        <ReportSheet
          visible={reportTarget !== null}
          target={reportTarget}
          onClose={() => setReportTarget(null)}
        />
      </View>
    </ImageViewerHost>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    scrollContent: {
      paddingHorizontal: theme.spacing(5),
      paddingTop: theme.spacing(2),
      paddingBottom: theme.spacing(8),
    },
    topRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: theme.spacing(1),
    },
    // 44pt targets, glyphs flush with the content edge.
    backBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: -11,
    },
    topRowSpacer: { flex: 1 },
    dotsBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      marginRight: -11,
    },
    spinner: { marginTop: theme.spacing(8) },
    spinnerSmall: { marginTop: theme.spacing(3) },
    header: { alignItems: "center", marginTop: theme.spacing(2), marginBottom: theme.spacing(7) },
    avatar: { marginBottom: theme.spacing(3.5) },
    nameRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
    name: {
      fontFamily: theme.fonts.serifBold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 24,
      color: theme.colors.textPrimary,
    },
    handle: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 13,
      color: theme.colors.textFaint,
      marginTop: theme.spacing(1),
    },
    streaks: {
      flexDirection: "row",
      justifyContent: "center",
      gap: theme.spacing(6),
      marginTop: theme.spacing(4),
    },
    streakStat: { alignItems: "center", gap: theme.spacing(1.5) },
    streakLabel: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    bio: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.textMuted,
      textAlign: "center",
      marginTop: theme.spacing(3),
      paddingHorizontal: theme.spacing(3),
    },
    editPill: {
      marginTop: theme.spacing(4),
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2.5),
      paddingHorizontal: theme.spacing(5),
    },
    editPillLabel: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13.5,
      color: theme.colors.textPrimary,
    },
    sectionLabel: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 11,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      color: theme.colors.textFaint,
      marginBottom: theme.spacing(3),
    },
    // Flat rows edge to edge, as in the feed: out of the screen padding,
    // a hairline above each one.
    feed: { marginHorizontal: -theme.spacing(5), marginBottom: theme.spacing(2) },
    row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.hairline },
    loadMore: {
      alignSelf: "center",
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2.5),
      paddingHorizontal: theme.spacing(5),
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginTop: theme.spacing(3),
      minWidth: 96,
      alignItems: "center",
    },
    loadMoreText: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    stateText: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 13.5,
      color: theme.colors.textMuted,
      textAlign: "center",
      marginTop: theme.spacing(8),
      marginBottom: theme.spacing(2),
    },
  });
}
