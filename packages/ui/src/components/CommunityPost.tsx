// Feed/thread post card. Ported from the mold's `CommunityPost`
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
  useCommunityConfig,
  useReactToPost,
  useToggleLike,
  type FeedPost,
} from "@rocapine/community-core";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { formatTimeAgo } from "../utils/time";
import { PollBlock } from "./PollBlock";

const BODY_CLAMP_LINES = 6;

export type PostSlots = {
  /** Wraps the whole footer row (like, reaction, comment, menu). Called with
   * the built-in row as `defaults` — return it as-is, restyle around it, or
   * replace it entirely. */
  renderPostFooter?: (post: FeedPost, defaults: ReactNode) => ReactNode;
  /** Wraps the built-in reaction stat, only ever called when
   * `cfg.modules.reaction` is enabled. */
  renderReactionButton?: (post: FeedPost, defaultButton: ReactNode) => ReactNode;
};

export function CommunityPost({
  post,
  onOpenThread,
  onOpenProfile,
  onMenu,
  renderPostFooter,
  renderReactionButton,
}: {
  post: FeedPost;
  onOpenThread(postId: string): void;
  onOpenProfile(userId: string): void;
  onMenu(post: FeedPost): void;
} & PostSlots) {
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);

  const toggleLike = useToggleLike();
  const reactToPost = useReactToPost();

  // Measure-then-clamp: the first layout pass renders unclamped and records
  // the natural line count (iOS onTextLayout only reports visible lines once
  // numberOfLines is set, so overflow cannot be detected after clamping).
  // Keyed list recycling remounts the card, which resets both states; a card
  // re-collapsing after scrolling far away is accepted (mold behavior, ported
  // as-is).
  const [fullLines, setFullLines] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const overflows = (fullLines ?? 0) > BODY_CLAMP_LINES;

  const handleOpenThread = () => onOpenThread(post.id);
  const handleOpenProfile = () => onOpenProfile(post.authorId);
  const handleMenu = () => onMenu(post);

  const handleToggleLike = () => {
    Haptics.selectionAsync().catch(() => {});
    toggleLike.mutate({ postId: post.id, liked: !post.likedByMe, topic: post.topic });
  };

  const handleReact = () => {
    if (post.hasReacted) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    reactToPost.mutate({ postId: post.id });
  };

  // `topics.*` only covers the host-config-driven topic list; an unknown
  // topic id (see core's normalizeTopic) falls back to showing itself raw,
  // by comparing the lookup result to the key it was asked for (makeT
  // returns the bare key on a miss).
  const topicKey = post.topic ? `topics.${post.topic}` : null;
  const topicLabel = topicKey ? (t(topicKey) === topicKey ? post.topic : t(topicKey)) : null;

  const authorHeader = (
    <>
      {post.authorAvatarUrl ? (
        <Image
          source={{ uri: post.authorAvatarUrl }}
          style={styles.avatarImage}
          contentFit="cover"
        />
      ) : (
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>{post.authorName.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.headerText}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{post.authorName}</Text>
          {post.authorOfficial && (
            <icons.officialSeal size={15} color={theme.colors.official} weight="fill" />
          )}
          {post.authorHandle != null && (
            <Text style={styles.handle} numberOfLines={1}>
              @{post.authorHandle}
            </Text>
          )}
        </View>
        <View style={styles.metaRow}>
          {post.pinnedAt != null && (
            <>
              <icons.pin size={11} color={theme.colors.pinned} weight="fill" />
              <Text style={styles.pinnedText}>{t("post.pinned")}</Text>
              <Text style={styles.meta}>·</Text>
            </>
          )}
          <Text style={styles.meta}>
            {topicLabel ? `${topicLabel} · ` : ""}
            {formatTimeAgo(t, post.createdAt, Date.now())}
          </Text>
        </View>
      </View>
    </>
  );

  const likeButton = (
    <Pressable hitSlop={8} onPress={handleToggleLike} style={styles.stat}>
      <icons.like
        size={18}
        color={post.likedByMe ? theme.colors.like : theme.colors.textFaint}
        weight={post.likedByMe ? "fill" : "regular"}
      />
      <Text style={[styles.statText, post.likedByMe && styles.statTextOn]}>{post.likeCount}</Text>
    </Pressable>
  );

  const defaultReactionButton = (
    <Pressable hitSlop={8} onPress={handleReact} disabled={post.hasReacted} style={styles.stat}>
      <icons.reaction
        size={18}
        color={post.hasReacted ? theme.colors.accent : theme.colors.textFaint}
        weight={post.hasReacted ? "fill" : "regular"}
      />
      <Text style={[styles.statText, post.hasReacted && styles.statTextOn]}>
        {post.reactionCount}
      </Text>
    </Pressable>
  );
  const reactionButton = cfg.modules.reaction
    ? (renderReactionButton?.(post, defaultReactionButton) ?? defaultReactionButton)
    : null;

  const commentButton = (
    <Pressable hitSlop={8} onPress={handleOpenThread} style={styles.stat}>
      <icons.comment size={18} color={theme.colors.textFaint} weight="regular" />
      <Text style={styles.statText}>{post.commentCount}</Text>
    </Pressable>
  );

  const menuButton = (
    <Pressable hitSlop={8} onPress={handleMenu} style={[styles.stat, styles.menuButton]}>
      <icons.menu size={20} color={theme.colors.textFaint} weight="bold" />
    </Pressable>
  );

  const defaultFooter = (
    <View style={styles.footer}>
      {likeButton}
      {reactionButton}
      {commentButton}
      {menuButton}
    </View>
  );
  const footer = renderPostFooter?.(post, defaultFooter) ?? defaultFooter;

  return (
    <Pressable
      onPress={handleOpenThread}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Pressable onPress={handleOpenProfile} hitSlop={4} style={styles.header}>
        {authorHeader}
      </Pressable>

      <Text
        style={styles.body}
        numberOfLines={fullLines !== null && !expanded ? BODY_CLAMP_LINES : undefined}
        onTextLayout={(e) => {
          if (fullLines === null) setFullLines(e.nativeEvent.lines.length);
        }}
      >
        {post.text}
      </Text>
      {overflows && (
        <Pressable hitSlop={8} onPress={() => setExpanded((v) => !v)}>
          <Text style={styles.viewMore}>{expanded ? t("post.viewLess") : t("post.viewMore")}</Text>
        </Pressable>
      )}

      {post.poll && <PollBlock post={post} />}

      {footer}
    </Pressable>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4.5),
      marginBottom: theme.spacing(3),
    },
    pressed: { opacity: 0.9 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      marginBottom: theme.spacing(3),
    },
    headerText: { flex: 1 },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarImage: { width: 40, height: 40, borderRadius: 20 },
    avatarLetter: { fontFamily: theme.fonts.serifBold, fontSize: 18, color: theme.colors.accent },
    nameRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1) },
    name: { fontFamily: theme.fonts.bold, fontSize: 14.5, color: theme.colors.textPrimary },
    handle: {
      fontFamily: theme.fonts.regular,
      fontSize: 12,
      color: theme.colors.textFaint,
      flexShrink: 1,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
      marginTop: 2,
    },
    pinnedText: { fontFamily: theme.fonts.bold, fontSize: 11.5, color: theme.colors.pinned },
    meta: { fontFamily: theme.fonts.regular, fontSize: 12, color: theme.colors.textFaint },
    body: {
      fontFamily: theme.fonts.regular,
      fontSize: 14.5,
      lineHeight: 22,
      color: theme.colors.textSecondary,
    },
    viewMore: {
      fontFamily: theme.fonts.medium,
      fontSize: 13,
      color: theme.colors.accent,
      marginTop: theme.spacing(1.5),
    },
    footer: { flexDirection: "row", gap: theme.spacing(6), marginTop: theme.spacing(3.5) },
    stat: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
    menuButton: { marginLeft: "auto" },
    statText: { fontFamily: theme.fonts.medium, fontSize: 13, color: theme.colors.textFaint },
    statTextOn: { color: theme.colors.accent },
  });
}
