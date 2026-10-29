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
//  - Images module (`cfg.modules.images`): while the reply field is focused or
//    an image is attached, the avatar on the left of the reply bar becomes the
//    add-image button; the attached photo shows as a thumbnail above the bar.
//    A comment's image renders at 60% of its column (percentage width +
//    aspect ratio: sized on the first layout pass, nothing jumps).

import {
  COMMENT_MAX_LENGTH,
  COMMUNITY_EVENTS,
  emitEvent,
  readerLocale,
  useBlockUser,
  useCommunityConfig,
  useCreateComment,
  useDeleteContent,
  useMyUid,
  useProfile,
  useThread,
  usePost,
  useToggleCommentLike,
  type FeedPost,
  type LocalImage,
  type ThreadComment,
} from "@rocapine/community-core";
import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
} from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { CommunitySheet, SHEET_GUTTER, SheetScrollView, SheetTextInput } from "../Sheet";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { CommunityPost, type PostSlots, type ProfileSource } from "../components/CommunityPost";
import { Avatar } from "../components/Avatar";
import { ClampedBody } from "../components/ClampedBody";
import { NoticeCard } from "../components/NoticeCard";
import { ReportSheet, type ReportTarget } from "../components/ReportSheet";
import { ImageViewerContext, useImageViewerOverlay } from "../components/ImageViewer";
import { PostImage } from "../components/PostImage";
import { imagesSupported, pickImage } from "../utils/postImage";
import { splitMentions, threadRows } from "../utils/threadRows";
import { isQueryLoading } from "../utils/query";
import { findCachedPost, subscribeToPostListCaches } from "../utils/postCache";
import { formatTimeAgo, secondsResolution, useNow } from "../utils/time";
import { displayText, translationLine } from "../utils/translation";
import { runGuarded } from "../utils/gate";
import { useRulesAccepted } from "../utils/rulesAcceptance";
import { ModalHandoffContext, type PresentModal } from "../utils/modalHandoff";
import { useMyAuthorName } from "../utils/myName";
import { RulesSheet } from "../components/RulesSheet";
import { haptic } from "../components/PressableScale";
import { noFocusRingMultiline } from "../utils/noFocusRing";

const COMMENT_CLAMP_LINES = 5;

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
  focusComment = false,
  onClose,
  onOpenProfile,
  onPressTopic,
  slots,
  beforeSubmitComment,
}: {
  postId: string | null;
  /** Open with the reply field focused (e.g. from a post's comment button). */
  focusComment?: boolean;
  onClose(): void;
  onOpenProfile(userId: string, source?: ProfileSource): void;
  /** The post's topic was tapped: the sheet closes, then this is called (the
   * feed selects that tab; elsewhere a host routes back to its feed). Absent:
   * the topic is not tappable. */
  onPressTopic?(topicId: string): void;
  slots?: PostSlots;
  /** Awaited before the comment is actually created (`useCreateComment().mutate`).
   * Absent ⇒ byte-identical behavior. Resolving/returning `false` (or
   * throwing) aborts the submit silently — no mutation, no error UI, and the
   * draft text is kept exactly as typed. Meant for a host-side async gate,
   * e.g. a paywall that resolves once the user is entitled. */
  beforeSubmitComment?: (draft: {
    postId: string;
    body: string;
    image?: LocalImage;
  }) => Promise<boolean>;
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
  // Not in any loaded list (opened from a notification): fetched on its own,
  // into a cache `useCachedPost` reads.
  usePost(shownId, post === null);
  const thread = useThread(shownId);
  const comments = thread.data ?? [];
  const rows = useMemo(() => threadRows(comments), [comments]);
  // @handle → member, for tappable mentions (only people in this thread).
  const handles = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of comments) if (c.authorHandle) map.set(c.authorHandle.toLowerCase(), c.authorId);
    return map;
  }, [comments]);

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
  const [image, setImage] = useState<LocalImage | null>(null);
  // Answering a comment: who, and the "@handle " the field was pre-filled with.
  const [replyTo, setReplyTo] = useState<{
    id: string;
    name: string;
    prefix: string;
  } | null>(null);
  // Read by the async send callbacks (the draft may have changed since).
  const latestDraft = useRef({ text, image });
  latestDraft.current = { text, image };
  const [inputFocused, setInputFocused] = useState(false);
  const imagesOn = !!cfg.modules.images && imagesSupported();
  // A draft belongs to its thread: reopening the same post keeps it, opening
  // another one starts empty.
  useEffect(() => {
    setText("");
    setImage(null);
    setReplyTo(null);
  }, [shownId]);
  // Rules gate on commenting, same shared flag as the feed composer (both
  // source apps gated the first comment behind the UGC rules sheet too).
  const rulesAccepted = useRulesAccepted(cfg);
  const [rulesVisible, setRulesVisible] = useState(false);
  const inputRef = useRef<ComponentRef<typeof SheetTextInput>>(undefined);
  const focusReply = () => {
    if (rulesAccepted) inputRef.current?.focus();
    else setRulesVisible(true);
  };
  useEffect(() => {
    if (!postId || !focusComment) return;
    // Once the sheet has slid up: focusing mid-animation fights the keyboard.
    const timer = setTimeout(focusReply, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, focusComment]);
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
  const myAuthorName = useMyAuthorName();
  // Double-submit latch for the `beforeSubmitComment` await: a second tap
  // during the await would otherwise run the host gate twice.
  const [gating, setGating] = useState(false);

  // True while a photo is picked and re-encoded (1–2 s for a large one): Send
  // waits for it so the text can't go out without its photo.
  const [preparing, setPreparing] = useState(false);
  const canSend = (text.trim().length > 0 || image !== null) && !gating && !preparing;
  // Hidden while the gate runs: a photo picked meanwhile would be cleared by the send.
  // Kept while preparing (the library blurs the field) to show the spinner.
  const showImageButton = imagesOn && (inputFocused || image !== null || preparing) && !gating;

  const attachImage = async () => {
    if (preparing) return;
    setPreparing(true);
    try {
      const picked = await pickImage();
      // Cancelled/failed: any attached image stays. A new pick replaces it.
      if (picked) setImage(picked);
    } finally {
      setPreparing(false);
    }
  };

  const startReply = (c: ThreadComment) => {
    const prefix = c.authorHandle ? `@${c.authorHandle} ` : "";
    // Swap the previous reply's untouched prefix, keep anything typed.
    setText((current) => {
      const typed = replyTo && current === replyTo.prefix ? "" : current;
      return typed.trim() ? typed : prefix;
    });
    setReplyTo({ id: c.id, name: c.authorName, prefix });
    focusReply();
  };
  const cancelReply = () => {
    if (replyTo && text === replyTo.prefix) setText("");
    setReplyTo(null);
  };

  const send = () => {
    const trimmed = text.trim();
    const sentImage = image;
    const sentReply = replyTo;
    if ((!trimmed && !sentImage) || !shownId || gating || preparing) return;
    if (!rulesAccepted) {
      setRulesVisible(true);
      return;
    }
    const postId = shownId;
    const draft = { postId, body: trimmed, image: sentImage ?? undefined };

    // A failed send: the draft (text + image) comes back when its thread is reopened, unless
    // a new one was started meanwhile — never into another thread the user
    // has moved to.
    const restoreDraft = () => {
      const now = latestDraft.current;
      if (shownIdRef.current !== postId || now.text.trim() || now.image) return;
      setText(trimmed);
      setImage(sentImage);
      setReplyTo(sentReply);
    };

    const doSend = () => {
      // Read after the gate: a host may set the display name in `beforeSubmitComment`.
      const authorName = myAuthorName();
      haptic("medium");
      createComment.mutate(
        { postId, text: trimmed, authorName, image: draft.image, parentId: sentReply?.id },
        {
          onSuccess: (res) => {
            if (res.verdict.status === "rejected") showNotice("rejected", postId);
          },
          onError: () => {
            restoreDraft();
            showNotice("network", postId);
          },
        },
      );
      setText("");
      setImage(null);
      setReplyTo(null);
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
  // The image viewer renders inside this sheet's Modal (`overlay`): a second
  // Modal over this one is what froze iOS in 0.4.2.
  const viewer = useImageViewerOverlay();

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
  const pressTopic = onPressTopic
    ? (topicId: string) => {
        onClose();
        onPressTopic(topicId);
      }
    : undefined;

  const handleDismissed = () => {
    viewer.close();
    // The field may unmount focused, without an onBlur.
    setInputFocused(false);
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
      <ImageViewerContext.Provider value={viewer.open}>
        <CommunitySheet
          visible={postId !== null}
          // Android back with the viewer up closes the viewer, not the thread.
          onClose={viewer.overlay ? viewer.close : onClose}
          onDismissed={handleDismissed}
          snapTo="full"
          overlay={viewer.overlay}
          footer={
            <>
              <View style={styles.rule} />
              {replyTo && (
                <View style={styles.replyingRow}>
                  <Text style={styles.replyingText} numberOfLines={1}>
                    {t("thread.replyingTo", { name: replyTo.name })}
                  </Text>
                  <Pressable
                    hitSlop={12}
                    onPress={cancelReply}
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.cancelReply")}
                  >
                    <icons.close size={14} color={theme.colors.textFaint} weight="bold" />
                  </Pressable>
                </View>
              )}
              {image !== null && (
                <View style={styles.thumbRow}>
                  <Image source={{ uri: image.url }} style={styles.thumb} contentFit="cover" />
                  <Pressable
                    hitSlop={14}
                    onPress={() => setImage(null)}
                    accessibilityRole="button"
                    accessibilityLabel={t("composer.removeImage")}
                  >
                    <icons.close size={16} color={theme.colors.textFaint} weight="bold" />
                  </Pressable>
                </View>
              )}
              <View style={[styles.inputRow, image !== null && styles.inputRowUnderThumb]}>
                {showImageButton ? (
                  <Pressable
                    onPress={attachImage}
                    disabled={preparing}
                    hitSlop={7}
                    style={styles.imageButton}
                    accessibilityRole="button"
                    accessibilityLabel={t("composer.addImage")}
                    accessibilityState={{ busy: preparing, disabled: preparing }}
                  >
                    {preparing ? (
                      <ActivityIndicator size="small" color={theme.colors.accent} />
                    ) : (
                      <icons.image size={20} color={theme.colors.accent} weight="regular" />
                    )}
                  </Pressable>
                ) : (
                  <Avatar userId={myUid} name={myAuthorName()} url={myAvatarUrl} size={30} />
                )}
                <SheetTextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={setText}
                  placeholder={t("thread.commentPlaceholder")}
                  placeholderTextColor={theme.colors.textFaint}
                  style={styles.input}
                  multiline
                  maxLength={COMMENT_MAX_LENGTH}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                />
                <Pressable
                  hitSlop={4}
                  onPress={send}
                  disabled={gating || preparing}
                  style={styles.send}
                  accessibilityRole="button"
                  accessibilityLabel={t("a11y.send")}
                >
                  <icons.send
                    size={20}
                    color={canSend ? theme.colors.accent : theme.colors.textFaint}
                    weight="fill"
                  />
                </Pressable>
                {/* Rules gate: swallow every touch on the comment box until the UGC
                rules are accepted. */}
                {!rulesAccepted && (
                  <Pressable style={StyleSheet.absoluteFill} onPress={() => setRulesVisible(true)}>
                    <View />
                  </Pressable>
                )}
              </View>
            </>
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
                {/* The row pads itself for the flat feed: cancel it so the
                    post lines up with the comments under the sheet's padding. */}
                <View style={styles.postBleed}>
                  <CommunityPost
                    post={post}
                    onPressComment={focusReply}
                    onOpenProfile={openProfile}
                    onMenu={openPostMenu}
                    onPressTopic={pressTopic}
                    {...slots}
                  />
                </View>
              </ModalHandoffContext.Provider>
            )}

            <View style={[styles.rule, styles.commentsRule]} />
            <Text style={styles.commentsLabel}>
              {t("thread.comments", { count: comments.length })}
            </Text>

            {isQueryLoading(thread) && comments.length === 0 ? (
              <Text style={styles.stateText}>{t("thread.loadingComments")}</Text>
            ) : comments.length === 0 ? (
              <Text style={styles.stateText}>{t("thread.emptyComments")}</Text>
            ) : (
              rows.map(({ comment: c, depth }) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  depth={depth}
                  postId={shownId!}
                  handles={handles}
                  onOpenProfile={openProfile}
                  onMenu={openCommentMenu}
                  onReply={startReply}
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
      </ImageViewerContext.Provider>

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
 * body with an inline "View more" (reuses `CommunityPost`'s `post.viewMore`
 * catalog key), and a
 * menu button. Ported from the mold's inline comment row in `CommunityThread`. */
function CommentRow({
  comment,
  depth,
  postId,
  handles,
  onOpenProfile,
  onMenu,
  onReply,
}: {
  comment: ThreadComment;
  /** 1 for a reply, shown indented under its root comment. */
  depth: 0 | 1;
  postId: string;
  /** @handle → member id, for tappable mentions. */
  handles: Map<string, string>;
  onOpenProfile(userId: string, source?: ProfileSource): void;
  onMenu(comment: ThreadComment): void;
  onReply(comment: ThreadComment): void;
}) {
  const now = useNow(secondsResolution(comment.createdAt, Date.now()));
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const cfg = useCommunityConfig();
  const openImage = useContext(ImageViewerContext);

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
  const toggleLike = useToggleCommentLike();
  // Not on the server yet: nothing to like or answer.
  const pending = comment.id.startsWith("optimistic-");

  const renderMentions = (shown: string) =>
    splitMentions(shown).map((part, i) => {
      if (!part.handle) return part.text;
      const userId = handles.get(part.handle);
      return (
        <Text
          key={i}
          style={styles.mention}
          onPress={userId ? () => onOpenProfile(userId, "comment") : undefined}
          suppressHighlighting
        >
          {part.text}
        </Text>
      );
    });

  return (
    <View style={[styles.comment, depth === 1 && styles.reply]}>
      <Pressable onPress={handleAuthor} hitSlop={4}>
        <Avatar
          userId={comment.authorId}
          name={comment.authorName}
          url={comment.authorAvatarUrl}
          size={depth === 1 ? 24 : 30}
        />
      </Pressable>
      <View style={styles.commentBody}>
        <Pressable onPress={handleAuthor} hitSlop={4} style={styles.nameRow}>
          <Text style={styles.cName} numberOfLines={1}>
            {comment.authorName}
          </Text>
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
        {/* Image-only comments store an empty text. */}
        {comment.text !== "" && (
          <ClampedBody
            text={displayText(comment, showOriginal)}
            alternate={comment.translation ? displayText(comment, !showOriginal) : null}
            clampLines={COMMENT_CLAMP_LINES}
            textStyle={styles.cText}
            viewMoreStyle={styles.cViewMore}
            renderText={renderMentions}
          />
        )}
        {toggleLine && (
          <Pressable hitSlop={8} onPress={toggleOriginal} style={styles.link}>
            <Text style={styles.cTranslationLine}>{toggleLine}</Text>
          </Pressable>
        )}
        {comment.image && (
          <View style={styles.cImage}>
            <PostImage image={comment.image} onOpen={openImage} />
          </View>
        )}
        {!pending && (
          <View style={styles.cActions}>
            <Pressable
              hitSlop={8}
              onPress={() => {
                haptic(comment.likedByMe ? "light" : "medium");
                toggleLike.mutate({ postId, commentId: comment.id, liked: !comment.likedByMe });
              }}
              style={styles.cAction}
              accessibilityRole="button"
              accessibilityLabel={t("a11y.like")}
              accessibilityState={{ selected: comment.likedByMe }}
            >
              <icons.like
                size={15}
                color={comment.likedByMe ? theme.colors.like : theme.colors.textFaint}
                weight={comment.likedByMe ? "fill" : "regular"}
              />
              {comment.likeCount > 0 && (
                <Text
                  style={[styles.cActionCount, comment.likedByMe && { color: theme.colors.like }]}
                >
                  {comment.likeCount}
                </Text>
              )}
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={() => onReply(comment)}
              style={styles.cAction}
              accessibilityRole="button"
              accessibilityLabel={t("a11y.reply")}
            >
              <icons.reply size={15} color={theme.colors.textFaint} weight="regular" />
            </Pressable>
          </View>
        )}
      </View>
      <Pressable
        hitSlop={8}
        onPress={() => onMenu(comment)}
        style={styles.cMenu}
        accessibilityRole="button"
        accessibilityLabel={t("a11y.more")}
      >
        <icons.menu size={18} color={theme.colors.textFaint} weight="bold" />
      </Pressable>
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    content: { paddingTop: theme.spacing(1), paddingBottom: theme.spacing(3) },
    postBleed: { marginHorizontal: -theme.spacing(4) },
    commentsLabel: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 11,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      color: theme.colors.textFaint,
      marginTop: theme.spacing(4.5),
      marginBottom: theme.spacing(4),
    },
    // Edge to edge, out of the sheet's gutter.
    rule: {
      height: 1,
      backgroundColor: theme.colors.border,
      marginHorizontal: -theme.spacing(SHEET_GUTTER),
    },
    commentsRule: { marginTop: theme.spacing(6) },
    stateText: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 13.5,
      color: theme.colors.textMuted,
      textAlign: "center",
      paddingVertical: theme.spacing(2),
    },
    comment: { flexDirection: "row", gap: theme.spacing(2.5), marginBottom: theme.spacing(4.5) },
    // Under the root comment's text column (avatar 30 + gap).
    reply: { marginLeft: 30 + theme.spacing(2.5) },
    cActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(5),
      marginTop: theme.spacing(1.5),
    },
    cAction: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1), minHeight: 20 },
    cActionCount: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
      color: theme.colors.textFaint,
    },
    mention: { color: theme.colors.accent, fontFamily: theme.fonts.medium },
    replyingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(2),
      paddingTop: theme.spacing(2.5),
    },
    replyingText: {
      flexShrink: 1,
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 12.5,
      color: theme.colors.textMuted,
    },
    commentBody: { flex: 1 },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
      alignSelf: "flex-start",
      maxWidth: "100%",
    },
    link: { alignSelf: "flex-start" },
    cName: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 13,
      color: theme.colors.textPrimary,
      flexShrink: 1,
    },
    handle: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 11.5,
      color: theme.colors.textFaint,
      flexShrink: 1,
    },
    cAgo: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 12,
      color: theme.colors.textFaint,
      flexShrink: 0,
    },
    cText: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.textSecondary,
      marginTop: 3,
    },
    cViewMore: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      color: theme.colors.accent,
    },
    // Quieter than the body whatever the host maps `textFaint` to.
    cTranslationLine: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 12,
      color: theme.colors.textFaint,
      opacity: 0.75,
      marginTop: theme.spacing(1.5),
    },
    cMenu: { paddingLeft: theme.spacing(1.5), paddingTop: 2 },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2.5),
      paddingTop: theme.spacing(3),
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
      fontWeight: theme.fontWeights.regular,
      fontSize: 14.5,
      color: theme.colors.textPrimary,
      ...noFocusRingMultiline,
    },
    send: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    // Same 30-pt slot as the avatar it replaces (44-pt target via hitSlop).
    imageButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
    thumbRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing(2),
      paddingTop: theme.spacing(3),
    },
    thumb: {
      width: 56,
      height: 56,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    inputRowUnderThumb: { paddingTop: theme.spacing(2) },
    // 60% of the comment column, height from the image's (clamped) ratio.
    cImage: { width: "60%", marginTop: theme.spacing(2) },
  });
}
