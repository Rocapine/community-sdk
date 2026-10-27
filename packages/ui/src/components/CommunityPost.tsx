// Feed/thread post row, flat and X-style (after Eve's `PostRow`): the avatar
// in a first column, everything else in a second one, nothing under the
// avatar; `name › topic · time` on one line with the menu at its end. Ported from the mold's `CommunityPost`
// (`sdk/client/components/community/CommunityPost.tsx`), reconciled with
// Eve's Rhythm's newer copy (`components/app/community/CommunityPost.tsx`)
// for the reaction footer — that host's "prayer" affordance (HandsPraying,
// `onPray`) is generalized here into a host-configurable "reaction" module
// (`cfg.modules.reaction`, `useReactToPost`), with a neutral HandHeart icon
// replacing the app-specific praying-hands one.
//
// Differences from both sources, per the task brief's exported signature:
//  - No `onToggleLike`/`onVote`/`onPray`/`nowMs` props: the card owns its own
//    mutations (`useToggleLike`, `useReactToPost`) and its own clock
//    (`Date.now()` read at render), and poll voting moved entirely into
//    `PollBlock` (it now takes the whole `post`).
//  - `onAuthorPress` (optional in the mold) is now the required
//    `onOpenProfile(userId)` — the header is always tappable.
//  - `onMenu` is called with the full `post`, not fired bare.
//  - The reaction stat only renders when `cfg.modules.reaction` is truthy,
//    and both it and the whole footer row are wrapped by the `PostSlots`
//    render-prop slots so a host can restyle or replace them without forking
//    this file.

import {
  COMMUNITY_EVENTS,
  emitEvent,
  isOptimistic,
  useCommunityConfig,
  useReactToPost,
  useToggleLike,
  type FeedPost,
} from "@rocapine/community-core";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, { FadeInDown, FadeInUp, LayoutAnimationConfig } from "react-native-reanimated";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { displayText, translationLine } from "../utils/translation";
import { formatTimeAgo, secondsResolution, useNow } from "../utils/time";
import { ModalHandoffContext, type PresentModal } from "../utils/modalHandoff";
import { ClampedBody } from "./ClampedBody";
import { Avatar } from "./Avatar";
import { ImageViewerContext } from "./ImageViewer";
import { PostImage } from "./PostImage";
import { PollBlock } from "./PollBlock";
import { haptic, PressableScale } from "./PressableScale";

const BODY_CLAMP_LINES = 6;

/** Where a profile was opened from — forwarded to the host's
 * `onOpenProfile` so it can hand it back to `ProfileScreen`'s `source` prop
 * (the `profileOpened` analytics event). */
export type ProfileSource = "post" | "comment";

/** Passed to every slot. `presentModal(open)`: use it to open your own
 * native Modal from a post — inside the thread sheet it closes the sheet
 * first and calls `open` once it's gone (iOS can't stack two Modals);
 * elsewhere it calls `open` right away. */
export type PostSlotContext = { presentModal: PresentModal };

export type PostSlots = {
  /** Wraps the whole footer row (like, reaction, comment). Called with
   * the built-in row as `defaults` — return it as-is, restyle around it, or
   * replace it entirely. */
  renderPostFooter?: (post: FeedPost, defaults: ReactNode, ctx: PostSlotContext) => ReactNode;
  /** Wraps the built-in reaction stat, only ever called when
   * `cfg.modules.reaction` is enabled. */
  renderReactionButton?: (
    post: FeedPost,
    defaultButton: ReactNode,
    ctx: PostSlotContext,
  ) => ReactNode;
};

export function CommunityPost({
  post,
  onOpenThread,
  onPressComment,
  onOpenProfile,
  onMenu,
  onPressTopic,
  renderPostFooter,
  renderReactionButton,
}: {
  post: FeedPost;
  /** Absent (e.g. inside the thread itself): the card is not tappable. */
  onOpenThread?(postId: string): void;
  /** The comment button. Defaults to `onOpenThread`; the feed opens the
   * thread with the reply field focused, the thread sheet focuses it. */
  onPressComment?(postId: string): void;
  onOpenProfile(userId: string, source?: ProfileSource): void;
  onMenu(post: FeedPost): void;
  /** The topic in the metadata line. Absent: the topic is not tappable. */
  onPressTopic?(topicId: string): void;
} & PostSlots) {
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);

  const now = useNow(secondsResolution(post.createdAt, Date.now()));
  const slotCtx: PostSlotContext = { presentModal: useContext(ModalHandoffContext) };
  const openImage = useContext(ImageViewerContext);
  // Image-only posts store `content = ''`: no text block (nor toggle line).
  const hasText = post.text !== "";
  const toggleLike = useToggleLike();
  const reactToPost = useReactToPost();

  const [showOriginal, setShowOriginal] = useState(false);
  const toggleLine = translationLine(t, post, showOriginal);
  const toggleOriginal = () => {
    emitEvent(cfg, COMMUNITY_EVENTS.translationToggled, {
      postId: post.id,
      to: showOriginal ? "translation" : "original",
    });
    setShowOriginal(!showOriginal);
  };

  // An optimistic own post may not know our uid yet (identity still
  // resolving): no profile to open, rather than a broken empty-id route.
  const handleOpenProfile = () => {
    if (post.authorId) onOpenProfile(post.authorId, "post");
  };
  // The placeholder's temp id can't be liked/reacted to server-side yet.
  const pending = isOptimistic(post);
  const handleMenu = () => onMenu(post);

  const handleToggleLike = () => {
    if (pending) return;
    haptic(post.likedByMe ? "light" : "medium");
    toggleLike.mutate({ postId: post.id, liked: !post.likedByMe, topic: post.topic });
  };

  const handleReact = () => {
    if (pending) return;
    haptic(post.hasReacted ? "light" : "medium");
    reactToPost.mutate({ postId: post.id, on: !post.hasReacted });
  };

  // Only a topic the host config lists is shown (and tappable): an unknown id
  // (see core's normalizeTopic) leaves `name · time`.
  const topicId = post.topic && cfg.topics.some((tp) => tp.id === post.topic) ? post.topic : null;

  const metaLine = (
    <View style={styles.metaRow}>
      <Pressable onPress={handleOpenProfile} hitSlop={4} style={styles.nameBlock}>
        <Text style={styles.name} numberOfLines={1}>
          {post.authorName}
        </Text>
        {post.authorOfficial && (
          <icons.officialSeal size={15} color={theme.colors.official} weight="fill" />
        )}
      </Pressable>
      {topicId && (
        <>
          <Text style={styles.meta}>›</Text>
          <Pressable
            onPress={onPressTopic ? () => onPressTopic(topicId) : undefined}
            disabled={!onPressTopic}
            hitSlop={6}
            style={styles.topic}
            accessibilityRole={onPressTopic ? "button" : undefined}
          >
            <Text style={styles.meta} numberOfLines={1}>
              {t(`topics.${topicId}`)}
            </Text>
          </Pressable>
        </>
      )}
      <Text style={styles.meta} numberOfLines={1}>
        · {formatTimeAgo(t, post.createdAt, now)}
      </Text>
      <Pressable
        hitSlop={8}
        onPress={handleMenu}
        style={styles.menuButton}
        accessibilityRole="button"
        accessibilityLabel={t("a11y.more")}
      >
        <icons.menu size={18} color={theme.colors.textFaint} weight="bold" />
      </Pressable>
    </View>
  );

  const likeButton = (
    <PressableScale hitSlop={4} onPress={handleToggleLike} style={styles.stat}>
      <icons.like
        size={18}
        color={post.likedByMe ? theme.colors.like : theme.colors.textFaint}
        weight={post.likedByMe ? "fill" : "regular"}
      />
      <StatCount
        value={post.likeCount}
        boxStyle={styles.statCount}
        style={[styles.statText, post.likedByMe && { color: theme.colors.like }]}
      />
    </PressableScale>
  );

  const defaultReactionButton = (
    <PressableScale hitSlop={4} onPress={handleReact} style={styles.stat}>
      <icons.reaction
        size={18}
        color={post.hasReacted ? theme.colors.reaction : theme.colors.textFaint}
        weight={post.hasReacted ? "fill" : "regular"}
      />
      <StatCount
        value={post.reactionCount}
        boxStyle={styles.statCount}
        style={[styles.statText, post.hasReacted && { color: theme.colors.reaction }]}
      />
    </PressableScale>
  );
  const reactionButton = cfg.modules.reaction
    ? (renderReactionButton?.(post, defaultReactionButton, slotCtx) ?? defaultReactionButton)
    : null;

  const commentButton = (
    <PressableScale
      hitSlop={4}
      onPress={() => (onPressComment ?? onOpenThread)?.(post.id)}
      style={styles.stat}
    >
      <icons.comment size={18} color={theme.colors.textFaint} weight="regular" />
      <StatCount value={post.commentCount} boxStyle={styles.statCount} style={styles.statText} />
    </PressableScale>
  );

  const defaultFooter = (
    <View style={styles.footer}>
      {likeButton}
      {reactionButton}
      {commentButton}
    </View>
  );
  const footer = renderPostFooter?.(post, defaultFooter, slotCtx) ?? defaultFooter;

  const content = (
    <>
      <Pressable onPress={handleOpenProfile} hitSlop={4} style={styles.avatarColumn}>
        <Avatar
          userId={post.authorId}
          name={post.authorName}
          url={post.authorAvatarUrl}
          size={40}
        />
      </Pressable>
      <View style={styles.main}>
        {post.pinnedAt != null && (
          <View style={styles.pinnedRow}>
            <icons.pin size={11} color={theme.colors.pinned} weight="fill" />
            <Text style={styles.pinnedText}>{t("post.pinned")}</Text>
          </View>
        )}
        {metaLine}

        {hasText && (
          <>
            <ClampedBody
              text={displayText(post, showOriginal)}
              alternate={post.translation ? displayText(post, !showOriginal) : null}
              clampLines={BODY_CLAMP_LINES}
              textStyle={styles.body}
              viewMoreStyle={styles.viewMore}
            />
            {toggleLine && (
              <Pressable hitSlop={8} onPress={toggleOriginal} style={styles.link}>
                <Text style={styles.translationLine}>{toggleLine}</Text>
              </Pressable>
            )}
          </>
        )}

        {post.image && (
          <View style={styles.imageGap}>
            <PostImage image={post.image} onOpen={openImage} />
          </View>
        )}

        {post.poll && <PollBlock post={post} showOriginal={showOriginal} />}

        {footer}
      </View>
    </>
  );

  return onOpenThread ? (
    <PressableScale scale="surface" onPress={() => onOpenThread(post.id)} style={styles.row}>
      {content}
    </PressableScale>
  ) : (
    <View style={styles.row}>{content}</View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      gap: theme.spacing(3),
      paddingVertical: theme.spacing(3.5),
      paddingHorizontal: theme.spacing(4),
      backgroundColor: theme.colors.background,
    },
    avatarColumn: { alignSelf: "flex-start" },
    main: { flex: 1, minWidth: 0 },
    pinnedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
      marginBottom: 2,
    },
    pinnedText: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 11.5,
      color: theme.colors.pinned,
    },
    // One line, always: the name gives way first, the time never does.
    metaRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1), minHeight: 22 },
    nameBlock: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
      flexShrink: 1,
      minWidth: 0,
    },
    name: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 14.5,
      color: theme.colors.textPrimary,
      flexShrink: 1,
    },
    // Capped rather than shrunk: the name gives way first, the topic only
    // past 40% of the line.
    topic: { flexShrink: 0, maxWidth: "40%" },
    meta: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 13,
      color: theme.colors.textFaint,
    },
    menuButton: { marginLeft: "auto", paddingLeft: theme.spacing(2) },
    body: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 14.5,
      lineHeight: 21,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
    viewMore: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      color: theme.colors.accent,
    },
    translationLine: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 12.5,
      color: theme.colors.textFaint,
      marginTop: theme.spacing(1.5),
    },
    footer: { flexDirection: "row", alignItems: "center", marginTop: theme.spacing(1) },
    // Fixed width + tabular digits: the row never shifts as counts change
    // (fits four digits).
    stat: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1.5),
      width: 64,
      height: 40,
    },
    link: { alignSelf: "flex-start" },
    imageGap: { marginTop: theme.spacing(2.5) },
    statCount: { flex: 1, overflow: "hidden" },
    statText: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
      color: theme.colors.textFaint,
    },
  });
}

/** A stat count that rolls in when it changes: from above when it goes up,
 * from below when it goes down (clipped by `boxStyle`). Not on first render,
 * so a freshly loaded feed stays still. */
function StatCount({
  value,
  boxStyle,
  style,
}: {
  value: number;
  boxStyle: StyleProp<ViewStyle>;
  style: StyleProp<TextStyle>;
}) {
  const prev = useRef(value);
  const up = value >= prev.current;
  useEffect(() => {
    prev.current = value;
  }, [value]);
  return (
    <View style={boxStyle}>
      <LayoutAnimationConfig skipEntering>
        <Animated.Text
          key={value}
          entering={(up ? FadeInUp : FadeInDown).duration(220)}
          numberOfLines={1}
          style={style}
        >
          {value}
        </Animated.Text>
      </LayoutAnimationConfig>
    </View>
  );
}
