// A community member's public profile: header (avatar/handle/bio/official
// seal), their posts (via `CommunityPost`, so it shares the feed's like/
// reaction/comment/menu footer and poll block), an edit affordance on one's
// own profile, and a block/report menu on someone else's. Ported from the
// mold's `UserProfileScreen` (`sdk/client/app/user/[id].tsx`).
//
// Router-free transformations (task brief):
//  - `useLocalSearchParams<{ id, source }>()` -> the `userId` prop; `source`
//    (used by the mold to distinguish a "post"/"comment"-origin visit for
//    analytics) has no equivalent prop on this screen's brief signature, so
//    `profileOpened` collapses the mold's three-way source into `"self"` vs
//    `"post"` here — see the effect below.
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
//  - No shared `nowMs` prop (Task 9/10/11 convention change, `CommunityPost`
//    already dropped it): `timeAgo` reads `Date.now()` at render inside
//    `CommunityPost` itself.

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
} from "@rocapine/community-core";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { CaretLeft, DotsThree, SealCheck } from "phosphor-react-native";
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
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { CommunityPost, type PostSlots } from "../components/CommunityPost";
import { ReportSheet, type ReportTarget } from "../components/ReportSheet";
import { isQueryLoading } from "../utils/query";
import { ProfileEditSheet } from "./ProfileEditSheet";

// Every post rendered on this screen already belongs to `userId` — see file
// header. Reusing this for `onOpenProfile` avoids a self-navigating tap.
const noop = () => {};

export function ProfileScreen({
  userId,
  onOpenThread,
  onBack,
  slots,
}: {
  userId: string;
  onOpenThread(postId: string): void;
  onBack?: () => void;
  slots?: PostSlots;
}) {
  const theme = useCommunityTheme();
  const t = useT();
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
    emitEvent(cfg, COMMUNITY_EVENTS.profileOpened, { source: isMe ? "self" : "post" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid, isMe]);

  const posts = userPosts.data?.pages.flat() ?? [];
  const hasNextPage = !!userPosts.hasNextPage;
  const isFetchingNextPage = userPosts.isFetchingNextPage;
  const loadMore = () => {
    if (userPosts.hasNextPage && !userPosts.isFetchingNextPage) userPosts.fetchNextPage();
  };

  const openPostMenu = (post: FeedPost) => {
    Haptics.selectionAsync().catch(() => {});
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
    Haptics.selectionAsync().catch(() => {});
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
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={profile.isRefetching || userPosts.isRefetching}
            onRefresh={() => {
              profile.refetch();
              userPosts.refetch();
            }}
            tintColor={theme.colors.accent}
          />
        }
      >
        <View style={styles.topRow}>
          {onBack ? (
            <Pressable hitSlop={10} onPress={onBack} style={styles.backBtn}>
              <CaretLeft size={22} color={theme.colors.textPrimary} weight="bold" />
            </Pressable>
          ) : (
            <View style={styles.topRowSpacer} />
          )}
          <View style={styles.topRowSpacer} />
          {myUid != null && !isMe && (
            <Pressable hitSlop={10} onPress={openHeaderMenu} style={styles.dotsBtn}>
              <DotsThree size={22} color={theme.colors.textPrimary} weight="bold" />
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
              {profile.data.avatarUrl ? (
                <Image
                  source={{ uri: profile.data.avatarUrl }}
                  style={styles.avatarImage}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarLetter}>
                    {profile.data.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.nameRow}>
                <Text style={styles.name}>{profile.data.name}</Text>
                {profile.data.official && (
                  <SealCheck size={17} color={theme.colors.official} weight="fill" />
                )}
              </View>
              {profile.data.handle != null && (
                <Text style={styles.handle}>@{profile.data.handle}</Text>
              )}
              {profile.data.bio ? <Text style={styles.bio}>{profile.data.bio}</Text> : null}
              {isMe && (
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setEditOpen(true);
                  }}
                  style={({ pressed }) => [styles.editPill, pressed && styles.pressed]}
                >
                  <Text style={styles.editPillLabel}>{t("profile.editProfile")}</Text>
                </Pressable>
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
                  <CommunityPost
                    key={post.id}
                    post={post}
                    onOpenThread={onOpenThread}
                    onOpenProfile={noop}
                    onMenu={openPostMenu}
                    {...slots}
                  />
                ))
              )}
              {hasNextPage && (
                <Pressable onPress={loadMore} style={styles.loadMore}>
                  {isFetchingNextPage ? (
                    <ActivityIndicator size="small" color={theme.colors.accent} />
                  ) : (
                    <Text style={styles.loadMoreText}>{t("feed.loadMore")}</Text>
                  )}
                </Pressable>
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
    backBtn: { padding: theme.spacing(1.5), marginLeft: -theme.spacing(1.5) },
    topRowSpacer: { flex: 1 },
    dotsBtn: { padding: theme.spacing(1.5), marginRight: -theme.spacing(1.5) },
    spinner: { marginTop: theme.spacing(8) },
    spinnerSmall: { marginTop: theme.spacing(3) },
    header: { alignItems: "center", marginTop: theme.spacing(2), marginBottom: theme.spacing(7) },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing(3.5),
    },
    avatarImage: { width: 72, height: 72, borderRadius: 36, marginBottom: theme.spacing(3.5) },
    avatarLetter: { fontFamily: theme.fonts.serifBold, fontSize: 30, color: theme.colors.accent },
    nameRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
    name: { fontFamily: theme.fonts.serifBold, fontSize: 24, color: theme.colors.textPrimary },
    handle: {
      fontFamily: theme.fonts.regular,
      fontSize: 13,
      color: theme.colors.textFaint,
      marginTop: theme.spacing(1),
    },
    bio: {
      fontFamily: theme.fonts.regular,
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
    pressed: { opacity: 0.85 },
    editPillLabel: {
      fontFamily: theme.fonts.medium,
      fontSize: 13.5,
      color: theme.colors.textPrimary,
    },
    sectionLabel: {
      fontFamily: theme.fonts.bold,
      fontSize: 11,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      color: theme.colors.textFaint,
      marginBottom: theme.spacing(3),
    },
    feed: { marginBottom: theme.spacing(2) },
    loadMore: {
      alignSelf: "center",
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2.5),
      paddingHorizontal: theme.spacing(5),
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginTop: theme.spacing(1),
      minWidth: 96,
      alignItems: "center",
    },
    loadMoreText: { fontFamily: theme.fonts.medium, fontSize: 13, color: theme.colors.textMuted },
    stateText: {
      fontFamily: theme.fonts.regular,
      fontSize: 13.5,
      color: theme.colors.textMuted,
      textAlign: "center",
      marginTop: theme.spacing(8),
      marginBottom: theme.spacing(2),
    },
  });
}
