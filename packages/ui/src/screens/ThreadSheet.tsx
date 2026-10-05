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
//  - No shared `nowMs` prop: each row reads the shared once-a-minute clock
//    (`useNow`), so "2m" keeps counting while the thread stays open.
//  - `open`/`post` collapse into the single `postId: string | null` prop; the
//    sheet is visible whenever `postId !== null`. The last non-null id is
//    kept in `shownId` so the post/comments stay mounted through the close
//    slide-down instead of flashing empty (mirrors the mold's own `[shown,
//    setShown]`).
//  - Reporting the opened post or a comment closes this sheet first (calls
//    `onClose()`) and opens `ReportSheet` from the thread sheet's
//    `onDismissed`, i.e. once its native `Modal` is fully dismissed — iOS
//    silently refuses to present a `Modal` while another is being
//    dismissed, so no fixed delay can be trusted. Delete/block act
//    immediately, no handoff needed since they don't open another modal
//    (deleting the opened post also closes the sheet, since there is nothing
//    left in it to show).
//  - A rejected or failed comment closes the sheet and shows its notice once
//    the sheet is dismissed (same handoff as Report): rendered behind the
//    sheet's Modal, it would only appear after the user closed the thread.
//  - A host slot opening its own Modal from the post card (e.g. Eve's prayer
//    sheet) goes through `ctx.presentModal`, which this sheet provides as
//    "close, then open once dismissed" (`ModalHandoffContext`).

import {
  COMMENT_MAX_LENGTH,
  COMMUNITY_EVENTS,
  displayName,
  emitEvent,
  readerLocale,
  useBlockUser,
  useCommunityConfig,
  useCreateComment,
  useDeleteContent,
  useMyUid,
  useProfile,
  useThread,
  type FeedPost,
  type ThreadComment,
} from "@rocapine/community-core";
import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { CommunitySheet, SheetScrollView, SheetTextInput } from "../Sheet";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { CommunityPost, type PostSlots, type ProfileSource } from "../components/CommunityPost";
import { ClampedBody } from "../components/ClampedBody";
import { NoticeCard } from "../components/NoticeCard";
import { ReportSheet, type ReportTarget } from "../components/ReportSheet";
import { isQueryLoading } from "../utils/query";
import { findCachedPost, subscribeToPostListCaches } from "../utils/postCache";
import { formatTimeAgo, useNow } from "../utils/time";
import { displayText, translationLine } from "../utils/translation";
import { runGuarded } from "../utils/gate";
import { useRulesAccepted } from "../utils/rulesAcceptance";
import { ModalHandoffContext, type PresentModal } from "../utils/modalHandoff";
import { RulesSheet } from "../components/RulesSheet";

const COMMENT_CLAMP_LINES = 5;

const noop = () => {};

/** Re-renders the caller only when the cached `FeedPost` it reads actually
 * changes (by reference — `useSyncExternalStore` bails out on an `Object.is`
 * match between snapshots), instead of on every relevant cache event.
 *
 * This replaces a real bug: the previous version subscribed to every
 * `["community", ...]` cache event unconditionally via a plain
 * `queryClient.getQueryCache().subscribe(() => forceUpdate(...))` effect,
 * which included this very screen's own `useThread(postId)` query below.
 * Opening a thread makes `useThread` transition loading→success (and its
 * comments query keeps emitting cache events for its own internal
 * bookkeeping), each of which called an unconditional `forceUpdate`,
 * re-rendering `ThreadSheet`, which re-invokes `useThread`, which emits more
 * cache events — a `queryCache` event ⇄ render loop bounded only by React's
 * "Maximum update depth exceeded" safety net (confirmed 22 iterations in one
 * thread open via a simulator QA session's log registry). `findCachedPost`
 * and `subscribeToPostListCaches` (which skips exactly those `thread` events,
 * on top of `useSyncExternalStore`'s own reference-equality bailout) live in
 * `../utils/postCache` — pulled out of this file so they're unit-testable
 * without mocking React Native/expo. */
function useCachedPost(postId: string | null, locale: string | null): FeedPost | null {
  const queryClient = useQueryClient();
  return useSyncExternalStore(
    (onStoreChange) => subscribeToPostListCaches(queryClient, postId, onStoreChange),
    () => (postId ? findCachedPost(queryClient, postId, locale) : null),
  );
}

export function ThreadSheet({
  postId,
  onClose,
  onOpenProfile,
  slots,
  beforeSubmitComment,
}: {
  postId: string | null;
  onClose(): void;
  onOpenProfile(userId: string, source?: ProfileSource): void;
  slots?: PostSlots;
  /** Awaited before the comment is actually created (`useCreateComment().mutate`).
   * Absent ⇒ byte-identical behavior. Resolving/returning `false` (or
   * throwing) aborts the submit silently — no mutation, no error UI, and the
   * draft text is kept exactly as typed. Meant for a host-side async gate,
   * e.g. a paywall that resolves once the user is entitled. */
  beforeSubmitComment?: (draft: { postId: string; body: string }) => Promise<boolean>;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
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

  const post = useCachedPost(shownId, readerLocale(cfg));
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
    const cached = findCachedPost(queryClient, postId, readerLocale(cfg));
    emitEvent(cfg, COMMUNITY_EVENTS.threadOpened, {
      postId,
      commentCount: cached?.commentCount ?? 0,
    });
    // Fires once per newly-opened thread; intentionally not re-run as `cfg`'s
    // identity changes underneath an already-open sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, queryClient]);

  const [text, setText] = useState("");
  // A draft belongs to its thread: reopening the same post keeps it, opening
  // another one starts empty.
  useEffect(() => setText(""), [shownId]);
  // Rules gate on commenting, same shared flag as the feed composer (both
  // source apps gated the first comment behind the UGC rules sheet too).
  const rulesAccepted = useRulesAccepted(cfg);
  const [rulesVisible, setRulesVisible] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  // Report chosen from this sheet: opened once the sheet is dismissed.
  const pendingReport = useRef<ReportTarget | null>(null);
  const [notice, setNotice] = useState<"rejected" | "network" | null>(null);
  // Notice raised while the sheet is up: shown once it's dismissed.
  const pendingNotice = useRef<"rejected" | "network" | null>(null);
  const visibleRef = useRef(postId !== null);
  visibleRef.current = postId !== null;
  const shownIdRef = useRef(shownId);
  shownIdRef.current = shownId;
  // `forPostId`: the thread the comment was sent from. If the user has since
  // moved to another thread, leave that one open; the notice waits for it.
  const showNotice = (kind: "rejected" | "network", forPostId: string) => {
    if (!visibleRef.current) {
      setNotice(kind);
      return;
    }
    pendingNotice.current = kind;
    if (shownIdRef.current === forPostId) onClose();
  };

  const myUid = useMyUid();
  const myAvatarUrl = useProfile(myUid).data?.avatarUrl ?? null;
  const myInitial = displayName(cfg.host.getDisplayName(), cfg.anonymousAuthorFallback)
    .charAt(0)
    .toUpperCase();
  // Double-submit latch for the `beforeSubmitComment` await — see the
  // matching note in `ComposerCard.tsx`'s `gating` state.
  const [gating, setGating] = useState(false);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || !shownId || gating) return;
    if (!rulesAccepted) {
      setRulesVisible(true);
      return;
    }
    const postId = shownId;
    const authorName = displayName(cfg.host.getDisplayName(), cfg.anonymousAuthorFallback);
    const draft = { postId, body: trimmed };

    const doSend = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      createComment.mutate(
        { postId, text: trimmed, authorName },
        {
          onSuccess: (res) => {
            if (res.verdict.status === "rejected") showNotice("rejected", postId);
          },
          onError: () => {
            // Draft comes back when its thread is reopened (unless a new one
            // was typed meanwhile), like the feed composer's — never into
            // another thread the user has moved to.
            if (shownIdRef.current === postId) {
              setText((current) => (current.trim() ? current : trimmed));
            }
            showNotice("network", postId);
          },
        },
      );
      setText("");
    };

    if (!beforeSubmitComment) {
      doSend();
      return;
    }
    setGating(true);
    runGuarded(beforeSubmitComment, draft, doSend).finally(() => setGating(false));
  };

  // A slot opening its own Modal from the post card (see `modalHandoff`):
  // close this sheet, open theirs once it's gone.
  const pendingOpen = useRef<(() => void) | null>(null);
  const presentAfterClose: PresentModal = (open) => {
    pendingOpen.current = open;
    onClose();
  };

  const closeThenReport = (target: ReportTarget) => {
    pendingReport.current = target;
    onClose();
  };

  // The sheet is a Modal, which stays above any route the host pushes: close
  // it first or the profile opens underneath. A push is not a modal
  // presentation, so unlike Report it needn't wait for the dismissal.
  const openProfile = (userId: string, source?: ProfileSource) => {
    onClose();
    onOpenProfile(userId, source);
  };

  const handleDismissed = () => {
    if (pendingOpen.current) {
      const open = pendingOpen.current;
      pendingOpen.current = null;
      open();
    }
    if (pendingNotice.current) {
      setNotice(pendingNotice.current);
      pendingNotice.current = null;
    }
    if (!pendingReport.current) return;
    setReportTarget(pendingReport.current);
    pendingReport.current = null;
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
      <CommunitySheet
        visible={postId !== null}
        onClose={onClose}
        onDismissed={handleDismissed}
        snapTo="full"
        footer={
          <View style={styles.inputRow}>
            {myAvatarUrl ? (
              <Image source={{ uri: myAvatarUrl }} style={styles.cAvatarImage} contentFit="cover" />
            ) : (
              <View style={styles.cAvatar}>
                <Text style={styles.cAvatarLetter}>{myInitial}</Text>
              </View>
            )}
            <SheetTextInput
              value={text}
              onChangeText={setText}
              placeholder={t("thread.commentPlaceholder")}
              placeholderTextColor={theme.colors.textFaint}
              style={styles.input}
              multiline
              maxLength={COMMENT_MAX_LENGTH}
            />
            <Pressable hitSlop={8} onPress={send} disabled={gating} style={styles.send}>
              <icons.send
                size={20}
                color={text.trim() && !gating ? theme.colors.accent : theme.colors.textFaint}
                weight="fill"
              />
            </Pressable>
            {/* Rules gate: swallow every touch on the comment box until the UGC
                rules are accepted (mirrors `ComposerCard`'s overlay). */}
            {!rulesAccepted && (
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setRulesVisible(true)}>
                <View />
              </Pressable>
            )}
          </View>
        }
      >
        {/* The whole thread (post + every comment) scrolls; the composer is the
            sheet's footer, pinned above the keyboard. */}
        <SheetScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {post && (
            <ModalHandoffContext.Provider value={presentAfterClose}>
              <CommunityPost
                post={post}
                onOpenThread={noop}
                onOpenProfile={openProfile}
                onMenu={openPostMenu}
                {...slots}
              />
            </ModalHandoffContext.Provider>
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
                onOpenProfile={openProfile}
                onMenu={openCommentMenu}
              />
            ))
          )}
        </SheetScrollView>

        <RulesSheet
          visible={rulesVisible}
          onAccepted={() => setRulesVisible(false)}
          onClose={() => setRulesVisible(false)}
        />
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
  onOpenProfile(userId: string, source?: ProfileSource): void;
  onMenu(comment: ThreadComment): void;
}) {
  const now = useNow();
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const cfg = useCommunityConfig();

  const [showOriginal, setShowOriginal] = useState(false);
  const toggleLine = translationLine(t, comment, showOriginal);
  const toggleOriginal = () => {
    emitEvent(cfg, COMMUNITY_EVENTS.translationToggled, {
      commentId: comment.id,
      to: showOriginal ? "translation" : "original",
    });
    setShowOriginal(!showOriginal);
  };

  // An optimistic own comment may not know our uid yet: nothing to open.
  const handleAuthor = () => {
    if (comment.authorId) onOpenProfile(comment.authorId, "comment");
  };

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
            <icons.officialSeal size={13} color={theme.colors.official} weight="fill" />
          )}
          {comment.authorHandle != null && (
            <Text style={styles.handle} numberOfLines={1}>
              @{comment.authorHandle}
            </Text>
          )}
          <Text style={styles.cAgo}>· {formatTimeAgo(t, comment.createdAt, now)}</Text>
        </Pressable>
        <ClampedBody
          text={displayText(comment, showOriginal)}
          alternate={comment.translation ? displayText(comment, !showOriginal) : null}
          clampLines={COMMENT_CLAMP_LINES}
          textStyle={styles.cText}
          viewMoreStyle={styles.cViewMore}
        />
        {toggleLine && (
          <Pressable hitSlop={8} onPress={toggleOriginal}>
            <Text style={styles.cTranslationLine}>{toggleLine}</Text>
          </Pressable>
        )}
      </View>
      <Pressable hitSlop={8} onPress={() => onMenu(comment)} style={styles.cMenu}>
        <icons.menu size={18} color={theme.colors.textFaint} weight="bold" />
      </Pressable>
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
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
    cTranslationLine: {
      fontFamily: theme.fonts.medium,
      fontSize: 12.5,
      color: theme.colors.textFaint,
      marginTop: theme.spacing(1.5),
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
