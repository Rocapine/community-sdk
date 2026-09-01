// A post's thread: the post itself (rendered through `CommunityPost`, so it
// gets the same like/reaction/comment/menu footer, poll block, and body-clamp
// behavior as a feed card) plus its comments and a comment composer. Ported
// from the mold's `CommunityThread`
// (`sdk/client/components/community/CommunityThread.tsx`).
//
// Standalone exported component (task brief's second signature): a host can
// mount `ThreadSheet` on its own — e.g. deep-linking straight into a thread
// from a push notification — without going through `CommunityFeedScreen`.
// Because of that it owns its own comment-menu (report/delete/block) and its
// own `ReportSheet` instance, exactly mirroring how `CommunityFeedScreen`
// owns those for the feed's own posts; there is no menu-related prop in the
// brief's signature to lift that state to a parent.
//
// Differences from the mold, beyond the standard router-free transformations:
//  - `postId` replaces the mold's `post: FeedPost | null` — this package has
//    no single-post fetch (Task 5 ruling: only feed/search/user-posts list
//    queries exist), so the post is read back out of the shared React Query
//    cache (feed / user-posts / search) by id via `useCachedPost` below. A
//    `postId` that was never loaded through any of those lists (e.g. a cold
//    deep link before the feed has ever fetched) renders comments-only, with
//    no post card above them — a known, accepted gap; closing it would need
//    a `fetchPost`-style addition to `core`, out of this task's file list.
//  - The post itself is rendered via `CommunityPost` (not a bespoke
//    `PostHead`), so it also gets a menu button here (the mold's
//    `CommunityThread` had none) — reporting/deleting/blocking from inside
//    an open thread wasn't possible there. `onOpenThread` on that instance is
//    a no-op: we're already inside the thread.
//  - No shared `nowMs` prop (Task 9/10/11 convention change, `CommunityPost`
//    already dropped it): `timeAgo` reads `Date.now()` at render.
//  - `open`/`post` collapse into the single `postId: string | null` prop; the
//    sheet is visible whenever `postId !== null`. The last non-null id is
//    kept in `shownId` so the post/comments stay mounted through the close
//    slide-down instead of flashing empty (mirrors the mold's own `[shown,
//    setShown]`).
//  - Reporting the opened post or a comment closes this sheet first (calls
//    `onClose()`) and opens `ReportSheet` after a 320ms delay — the same
//    modal-handoff the mold/Eve use everywhere a second native `Modal` must
//    replace one that's still animating closed (two `Modal`s cannot present
//    at once on iOS). Delete/block act immediately, no handoff needed since
//    they don't open another modal (deleting the opened post also closes the
//    sheet, since there is nothing left in it to show).

import {
  COMMENT_MAX_LENGTH,
  COMMUNITY_EVENTS,
  displayName,
  emitEvent,
  useBlockUser,
  useCommunityConfig,
  useCreateComment,
  useDeleteContent,
  useThread,
  type FeedPost,
  type ThreadComment,
} from "@rocapine/community-core";
import { useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { DotsThree, PaperPlaneRight, SealCheck } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CommunitySheet } from "../Sheet";
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { CommunityPost, type PostSlots } from "../components/CommunityPost";
import { NoticeCard } from "../components/NoticeCard";
import { ReportSheet, type ReportTarget } from "../components/ReportSheet";
import { isQueryLoading } from "../utils/query";
import { formatTimeAgo } from "../utils/time";

const COMMENT_CLAMP_LINES = 5;
const HANDOFF_DELAY_MS = 320;

const noop = () => {};

/** Finds a `FeedPost` by id across every cache that can hold one — the topic
 * feeds, user-posts and search results, all paginated `InfiniteData` —
 * mirroring the set of caches `useReactToPost`/`useVotePoll` sweep in
 * `core/hooks.ts`. Subscribes to the query cache so the result stays live as
 * those mutations' optimistic updates land (like/react/vote), at the cost of
 * re-rendering on any community cache change while a thread is open — an
 * accepted trade-off for a bottom sheet, not a hot path. */
function findCachedPost(queryClient: QueryClient, postId: string): FeedPost | null {
  const entries = [
    ...queryClient.getQueriesData<InfiniteData<FeedPost[]>>({ queryKey: ["community", "feed"] }),
    ...queryClient.getQueriesData<InfiniteData<FeedPost[]>>({
      queryKey: ["community", "userPosts"],
    }),
    ...queryClient.getQueriesData<InfiniteData<FeedPost[]>>({ queryKey: ["community", "search"] }),
  ];
  for (const [, data] of entries) {
    if (!data) continue;
    for (const page of data.pages) {
      const found = page.find((p) => p.id === postId);
      if (found) return found;
    }
  }
  return null;
}

/** Re-renders the caller whenever a `["community", ...]` query changes.
 * Gated on `postId !== null`: `ThreadSheet` is mounted by its host for its
 * entire lifetime (postId flips between a value and `null`, the component
 * itself never unmounts), so an unconditional subscription here would listen
 * to the whole shared `QueryClient` — every query any other feature in the
 * host app runs — for as long as the sheet has never been opened. Once a
 * thread has been opened, `shownId` (the caller's `postId` argument) never
 * goes back to `null` (see the "keep last known id" note above), so the
 * subscription then lives for the rest of the sheet's mount — same as
 * before, just no longer paying for it before the first open. */
function useCachedPost(postId: string | null): FeedPost | null {
  const queryClient = useQueryClient();
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!postId) return;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "community") forceUpdate((n) => n + 1);
    });
    return unsubscribe;
  }, [queryClient, postId]);
  return postId ? findCachedPost(queryClient, postId) : null;
}

export function ThreadSheet({
  postId,
  onClose,
  onOpenProfile,
  slots,
}: {
  postId: string | null;
  onClose(): void;
  onOpenProfile(userId: string): void;
  slots?: PostSlots;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();

  const createComment = useCreateComment();
  const blockUser = useBlockUser();
  const deleteContent = useDeleteContent();

  // Keep the last opened post's id through the close animation so content
  // doesn't flash empty while the sheet slides down (mirrors the mold's own
  // `[shown, setShown]` on the whole post object).
  const [shownId, setShownId] = useState<string | null>(postId);
  useEffect(() => {
    if (postId) setShownId(postId);
  }, [postId]);

  const post = useCachedPost(shownId);
  const thread = useThread(shownId);
  const comments = thread.data ?? [];

  useEffect(() => {
    if (!postId) return;
    // Look the post up directly by the effect's own `postId`, not the
    // render-time `post`/`shownId` above: `shownId` only catches up to
    // `postId` in a *separate* effect (`setShownId`, above), so on the render
    // where `postId` first goes non-null, `post` is still derived from the
    // previous (stale) `shownId` — reading `post.commentCount` here always
    // observed 0 (or the previous thread's count). Reading the cache fresh at
    // the moment this effect fires sidesteps that ordering entirely.
    const cached = findCachedPost(queryClient, postId);
    emitEvent(cfg, COMMUNITY_EVENTS.threadOpened, {
      postId,
      commentCount: cached?.commentCount ?? 0,
    });
    // Fires once per newly-opened thread; intentionally not re-run as `cfg`'s
    // identity changes underneath an already-open sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, queryClient]);

  const [text, setText] = useState("");
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [notice, setNotice] = useState<"rejected" | "network" | null>(null);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || !shownId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const authorName = displayName(cfg.host.getDisplayName(), cfg.anonymousAuthorFallback);
    createComment.mutate(
      { postId: shownId, text: trimmed, authorName },
      {
        onSuccess: (res) => {
          if (res.verdict.status === "rejected") setNotice("rejected");
        },
        onError: () => setNotice("network"),
      },
    );
    setText("");
  };

  const closeThenReport = (target: ReportTarget) => {
    onClose();
    setTimeout(() => setReportTarget(target), HANDOFF_DELAY_MS);
  };

  const openPostMenu = (p: FeedPost) => {
    Haptics.selectionAsync().catch(() => {});
    if (p.isOwn) {
      Alert.alert(t("menu.deletePostTitle"), t("menu.deletePostBody"), [
        { text: t("menu.cancel"), style: "cancel" },
        {
          text: t("menu.delete"),
          style: "destructive",
          onPress: () => {
            onClose();
            deleteContent.mutate({ kind: "post", id: p.id, postId: p.id });
          },
        },
      ]);
      return;
    }
    Alert.alert(p.authorName, undefined, [
      {
        text: t("menu.reportPost"),
        onPress: () => closeThenReport({ kind: "post", id: p.id, authorId: p.authorId }),
      },
      {
        text: t("menu.blockUser", { name: p.authorName }),
        style: "destructive",
        onPress: () =>
          Alert.alert(
            t("menu.blockUserConfirmTitle", { name: p.authorName }),
            t("menu.blockUserConfirmBody"),
            [
              { text: t("menu.cancel"), style: "cancel" },
              {
                text: t("menu.block"),
                style: "destructive",
                onPress: () => {
                  onClose();
                  blockUser.mutate({ userId: p.authorId });
                },
              },
            ],
          ),
      },
      { text: t("menu.cancel"), style: "cancel" },
    ]);
  };

  const openCommentMenu = (c: ThreadComment) => {
    Haptics.selectionAsync().catch(() => {});
    if (c.isOwn) {
      Alert.alert(t("menu.deleteCommentTitle"), undefined, [
        { text: t("menu.cancel"), style: "cancel" },
        {
          text: t("menu.delete"),
          style: "destructive",
          onPress: () => deleteContent.mutate({ kind: "comment", id: c.id, postId: c.postId }),
        },
      ]);
      return;
    }
    Alert.alert(c.authorName, undefined, [
      {
        text: t("menu.reportComment"),
        onPress: () => closeThenReport({ kind: "comment", id: c.id, authorId: c.authorId }),
      },
      {
        text: t("menu.blockUser", { name: c.authorName }),
        style: "destructive",
        onPress: () =>
          Alert.alert(
            t("menu.blockUserConfirmTitle", { name: c.authorName }),
            t("menu.blockUserConfirmBody"),
            [
              { text: t("menu.cancel"), style: "cancel" },
              {
                text: t("menu.block"),
                style: "destructive",
                onPress: () => {
                  onClose();
                  blockUser.mutate({ userId: c.authorId });
                },
              },
            ],
          ),
      },
      { text: t("menu.cancel"), style: "cancel" },
    ]);
  };

  return (
    <>
      <CommunitySheet visible={postId !== null} onClose={onClose} snapTo="full">
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {post && (
            <CommunityPost
              post={post}
              onOpenThread={noop}
              onOpenProfile={onOpenProfile}
              onMenu={openPostMenu}
              {...slots}
            />
          )}

          <Text style={styles.commentsLabel}>
            {t("thread.comments", { count: comments.length })}
          </Text>

          {isQueryLoading(thread) && comments.length === 0 ? (
            <Text style={styles.stateText}>{t("thread.loadingComments")}</Text>
          ) : comments.length === 0 ? (
            <Text style={styles.stateText}>{t("thread.emptyComments")}</Text>
          ) : (
            comments.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                onOpenProfile={onOpenProfile}
                onMenu={openCommentMenu}
              />
            ))
          )}
        </ScrollView>

        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("thread.commentPlaceholder")}
            placeholderTextColor={theme.colors.textFaint}
            style={styles.input}
            multiline
            maxLength={COMMENT_MAX_LENGTH}
          />
          <Pressable hitSlop={8} onPress={send} style={styles.send}>
            <PaperPlaneRight
              size={20}
              color={text.trim() ? theme.colors.accent : theme.colors.textFaint}
              weight="fill"
            />
          </Pressable>
        </View>
      </CommunitySheet>

      {notice && <NoticeCard kind={notice} target="comment" onDismiss={() => setNotice(null)} />}

      <ReportSheet
        visible={reportTarget !== null}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
      />
    </>
  );
}

/** One comment row: avatar, name/handle/official badge/timestamp, clamped
 * body with a view more/less toggle (reuses `CommunityPost`'s `post.viewMore`/
 * `post.viewLess` catalog keys — same semantics, no new keys needed), and a
 * menu button. Ported from the mold's inline comment row in `CommunityThread`. */
function CommentRow({
  comment,
  onOpenProfile,
  onMenu,
}: {
  comment: ThreadComment;
  onOpenProfile(userId: string): void;
  onMenu(comment: ThreadComment): void;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const styles = useThemedStyles(makeStyles);

  const [fullLines, setFullLines] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const overflows = (fullLines ?? 0) > COMMENT_CLAMP_LINES;

  const handleAuthor = () => onOpenProfile(comment.authorId);

  return (
    <View style={styles.comment}>
      <Pressable onPress={handleAuthor} hitSlop={4}>
        {comment.authorAvatarUrl ? (
          <Image
            source={{ uri: comment.authorAvatarUrl }}
            style={styles.cAvatarImage}
            contentFit="cover"
          />
        ) : (
          <View style={styles.cAvatar}>
            <Text style={styles.cAvatarLetter}>{comment.authorName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
      </Pressable>
      <View style={styles.commentBody}>
        <Pressable onPress={handleAuthor} hitSlop={4} style={styles.nameRow}>
          <Text style={styles.cName}>{comment.authorName}</Text>
          {comment.authorOfficial && (
            <SealCheck size={13} color={theme.colors.official} weight="fill" />
          )}
          {comment.authorHandle != null && (
            <Text style={styles.handle} numberOfLines={1}>
              @{comment.authorHandle}
            </Text>
          )}
          <Text style={styles.cAgo}>· {formatTimeAgo(t, comment.createdAt, Date.now())}</Text>
        </Pressable>
        <Text
          style={styles.cText}
          numberOfLines={fullLines !== null && !expanded ? COMMENT_CLAMP_LINES : undefined}
          onTextLayout={(e) => {
            if (fullLines === null) setFullLines(e.nativeEvent.lines.length);
          }}
        >
          {comment.text}
        </Text>
        {overflows && (
          <Pressable hitSlop={8} onPress={() => setExpanded((v) => !v)}>
            <Text style={styles.cViewMore}>
              {expanded ? t("post.viewLess") : t("post.viewMore")}
            </Text>
          </Pressable>
        )}
      </View>
      <Pressable hitSlop={8} onPress={() => onMenu(comment)} style={styles.cMenu}>
        <DotsThree size={18} color={theme.colors.textFaint} weight="bold" />
      </Pressable>
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    scroll: { flexShrink: 1 },
    content: { paddingTop: theme.spacing(1), paddingBottom: theme.spacing(3) },
    commentsLabel: {
      fontFamily: theme.fonts.bold,
      fontSize: 11,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      color: theme.colors.textFaint,
      marginTop: theme.spacing(6),
      marginBottom: theme.spacing(4),
      paddingTop: theme.spacing(4.5),
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    stateText: {
      fontFamily: theme.fonts.regular,
      fontSize: 13.5,
      color: theme.colors.textMuted,
      textAlign: "center",
      paddingVertical: theme.spacing(2),
    },
    comment: { flexDirection: "row", gap: theme.spacing(2.5), marginBottom: theme.spacing(4.5) },
    cAvatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    cAvatarImage: { width: 30, height: 30, borderRadius: 15 },
    cAvatarLetter: { fontFamily: theme.fonts.serifBold, fontSize: 13, color: theme.colors.accent },
    commentBody: { flex: 1 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1) },
    cName: { fontFamily: theme.fonts.bold, fontSize: 13, color: theme.colors.textPrimary },
    handle: {
      fontFamily: theme.fonts.regular,
      fontSize: 11.5,
      color: theme.colors.textFaint,
      flexShrink: 1,
    },
    cAgo: { fontFamily: theme.fonts.regular, fontSize: 12, color: theme.colors.textFaint },
    cText: {
      fontFamily: theme.fonts.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.textSecondary,
      marginTop: 3,
    },
    cViewMore: {
      fontFamily: theme.fonts.medium,
      fontSize: 12.5,
      color: theme.colors.accent,
      marginTop: theme.spacing(1),
    },
    cMenu: { paddingLeft: theme.spacing(1.5), paddingTop: 2 },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2.5),
      paddingTop: theme.spacing(3),
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    input: {
      flex: 1,
      maxHeight: 100,
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2.5),
      fontFamily: theme.fonts.regular,
      fontSize: 14.5,
      color: theme.colors.textPrimary,
    },
    send: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  });
}
