// One chat message (validated mockup "bubbles"): mine on the right in the accent
// color, others' on the left. Consecutive messages by one author form a run: the
// name (groups) on its first bubble, the avatar and the tail corner on its last. A
// reply quotes its target inside the bubble; likes sit in a pill on the bubble's edge.
//
// Gestures: a double tap (double click on web) likes or unlikes, with a small heart
// pop; a swipe right (native only) replies — the bubble follows the finger a little, a
// reply icon shows, a haptic marks the threshold. Vertical moves stay the list's, and
// touches at the screen's left edge stay the system's back swipe. The menu (long
// press, right click or the "…" on hover or focus on web) keeps Like and Reply, and
// screen readers get both as actions.
import {
  isOptimistic,
  messageImageUrl,
  useCommunityConfig,
  useProfile,
  type ChatMessage,
  type PostAttachment,
} from "@rocapine/community-core";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { memo, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../../ThemeProvider";
import type { CommunityTheme } from "../../theme";
import {
  SWIPE_MAX,
  formatClock,
  startsAtEdge,
  swipeOffset,
  swipeTriggered,
} from "../../utils/chat";
import { imageRatio } from "../../utils/postImage";
import { AttachmentCard } from "../AttachmentCard";
import { Avatar } from "../Avatar";
import { ImageViewerContext } from "../ImageViewer";
import { haptic } from "../PressableScale";
import { QuoteBlock } from "./QuoteBlock";

const AVATAR = 28;
const IMAGE_WIDTH = 220;
const SIGNED_URL_STALE_MS = 50 * 60_000;
const web = Platform.OS === "web";
const HEART = 36;

// Memoized: the screen re-renders on every keystroke of the composer.
export const MessageBubble = memo(function MessageBubble({
  message: m,
  own,
  showName,
  first,
  last,
  translation,
  onShowOriginal,
  onMenu,
  onToggleLike,
  onReply,
  onOpenProfile,
  onPressQuote,
  onOpenAttachment,
}: {
  message: ChatMessage;
  own: boolean;
  /** The author's name above the bubble (groups, others' messages), on a run's first. */
  showName: boolean;
  /** The oldest message of its run (one author, one day, nobody in between). */
  first: boolean;
  /** The newest of its run: the avatar and the tail corner. */
  last: boolean;
  /** The on-demand translation, shown in place of the text. */
  translation?: string;
  onShowOriginal?(messageId: string): void;
  /** Absent: no menu (a message being sent, or gone). `authorAdmin`: the author is
   * an app admin (a group's creator can't delete their messages). */
  onMenu?(m: ChatMessage, authorAdmin: boolean): void;
  /** Absent: no double tap, and the like pill only shows the count. */
  onToggleLike?(m: ChatMessage): void;
  /** Absent: no swipe to reply. */
  onReply?(m: ChatMessage): void;
  onOpenProfile(userId: string): void;
  onPressQuote(messageId: string): void;
  onOpenAttachment?(a: PostAttachment): void;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const cfg = useCommunityConfig();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const author = useProfile(own ? null : m.authorId).data;
  const [hover, setHover] = useState(false);
  // Web keyboard: the "…" shows while the bubble or the "…" itself has the focus. A
  // blur hides it one tick later, so focus can move from one to the other.
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focus = () => {
    clearTimeout(blurTimer.current);
    setFocused(true);
  };
  const blur = () => {
    blurTimer.current = setTimeout(() => setFocused(false), 0);
  };
  const gone = m.status === "deleted" || m.status === "hidden";
  const textColor = own ? theme.colors.textInverse : theme.colors.textPrimary;
  const authorAdmin = author?.admin ?? false;
  const showMenu = onMenu ? () => onMenu(m, authorAdmin) : undefined;
  const openMenu = showMenu
    ? () => {
        haptic("light");
        showMenu();
      }
    : undefined;
  // Web only: the browser's own menu gives way to ours.
  const contextMenu =
    web && onMenu
      ? {
          onContextMenu: (e: { preventDefault(): void }) => {
            e.preventDefault();
            showMenu!();
          },
        }
      : {};

  // ---- gestures ----
  const reduceMotion = useReducedMotion();
  const swipe = useSharedValue(0);
  const armed = useSharedValue(false);
  const pop = useSharedValue(0);
  // The gestures are built once per capability; they read the latest props from here.
  // Never captured by a worklet (Reanimated would freeze it): JS callbacks only.
  const latest = useRef({ m, onToggleLike, onReply, reduceMotion });
  latest.current = { m, onToggleLike, onReply, reduceMotion };
  const like = useCallback(() => {
    const { m: msg, onToggleLike: toggle, reduceMotion: still } = latest.current;
    if (!toggle) return;
    // Only a like pops; Reduce Motion fades the heart without the scale.
    if (!msg.likedByMe)
      pop.value = withSequence(
        withTiming(1, { duration: still ? 120 : 180 }),
        withDelay(320, withTiming(0, { duration: 200 })),
      );
    toggle(msg);
  }, [pop]);
  const reply = useCallback(() => latest.current.onReply?.(latest.current.m), []);
  const tick = useCallback(() => haptic("light"), []);
  const canLike = !!onToggleLike;
  const canReply = !web && !!onReply;
  const gesture = useMemo(() => {
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .enabled(canLike)
      .onEnd((_e, success) => {
        "worklet";
        if (success) runOnJS(like)();
      });
    const pan = Gesture.Pan()
      .enabled(canReply)
      // Right only, past a few points; any vertical move first leaves it to the list.
      .activeOffsetX(12)
      .failOffsetX(-12)
      .failOffsetY([-10, 10])
      .onTouchesDown((e, manager) => {
        "worklet";
        const touch = e.changedTouches[0];
        if (touch && startsAtEdge(touch.absoluteX)) manager.fail();
      })
      .onUpdate((e) => {
        "worklet";
        swipe.value = swipeOffset(e.translationX);
        const on = swipeTriggered(e.translationX);
        if (on !== armed.value) {
          armed.value = on;
          if (on) runOnJS(tick)();
        }
      })
      .onEnd((e) => {
        "worklet";
        if (swipeTriggered(e.translationX)) runOnJS(reply)();
      })
      .onFinalize(() => {
        "worklet";
        armed.value = false;
        swipe.value = reduceMotion
          ? withTiming(0, { duration: 150 })
          : withSpring(0, { damping: 20, stiffness: 260 });
      });
    return Gesture.Race(pan, doubleTap);
  }, [canLike, canReply, reduceMotion, like, reply, tick, swipe, armed]);
  const swipeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: swipe.value }] }));
  const replyIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(swipe.value, [SWIPE_MAX / 3, SWIPE_MAX], [0, 1], "clamp"),
    transform: [{ scale: interpolate(swipe.value, [0, SWIPE_MAX], [0.6, 1], "clamp") }],
  }));
  const heartStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: reduceMotion ? 1 : 0.5 + 0.6 * pop.value }],
  }));
  const a11yActions = [
    ...(onMenu ? [{ name: "longpress", label: t("chat.menu.more") }] : []),
    ...(onToggleLike
      ? [{ name: "like", label: t(m.likedByMe ? "chat.menu.unlike" : "chat.menu.like") }]
      : []),
    ...(onReply ? [{ name: "reply", label: t("chat.menu.reply") }] : []),
  ];
  const onA11yAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === "like") onToggleLike?.(m);
    else if (name === "reply") onReply?.(m);
    else openMenu?.();
  };

  const time = formatClock(m.createdAt, cfg.host.getLocale());
  const meta = m.editedAt && !gone ? `${time} · ${t("chat.edited")}` : time;

  const bubble = (
    <Pressable
      onLongPress={openMenu}
      onFocus={focus}
      onBlur={blur}
      style={[
        styles.bubble,
        own ? styles.bubbleOwn : styles.bubbleOther,
        last && (own ? styles.tailOwn : styles.tailOther),
        (isOptimistic(m) || m.status === "pending") && styles.sending,
      ]}
      accessibilityActions={a11yActions.length > 0 ? a11yActions : undefined}
      onAccessibilityAction={onA11yAction}
      {...contextMenu}
    >
      {showName && first && author && (
        <Text style={styles.name} numberOfLines={1}>
          {author.name}
        </Text>
      )}
      {gone ? (
        <Text style={[styles.body, styles.deleted, { color: textColor }]}>
          {m.status === "hidden"
            ? t("chat.hidden")
            : m.deletedBy === "creator"
              ? t("chat.deletedByCreator")
              : t("chat.deleted")}
        </Text>
      ) : (
        <>
          {m.replyTo && (
            <QuoteBlock
              replyTo={m.replyTo}
              color={textColor}
              onPress={() => onPressQuote(m.replyTo!.id)}
            />
          )}
          {m.imagePath && <MessageImage message={m} />}
          {m.attachment && (
            <AttachmentCard
              attachment={m.attachment}
              placement="message"
              variant="compact"
              onOpen={onOpenAttachment}
            />
          )}
          {!!(translation ?? m.body) && (
            <Text style={[styles.body, { color: textColor }]} selectable={web}>
              {translation ?? m.body}
            </Text>
          )}
          {translation !== undefined && (
            <Text
              style={[styles.meta, styles.link, { color: textColor }]}
              onPress={() => onShowOriginal?.(m.id)}
              accessibilityRole="button"
            >
              {t("translation.showOriginal")}
            </Text>
          )}
        </>
      )}
      <Text style={[styles.meta, { color: textColor }]}>{meta}</Text>
      {m.likeCount > 0 && !gone && (
        <Pressable
          onPress={onToggleLike ? () => onToggleLike(m) : undefined}
          disabled={!onToggleLike}
          hitSlop={6}
          style={[styles.like, own ? styles.likeOwn : styles.likeOther]}
          accessibilityRole="button"
          accessibilityLabel={`${t("a11y.like")} ${m.likeCount}`}
          accessibilityState={{ selected: m.likedByMe }}
        >
          <icons.like
            size={10}
            color={m.likedByMe ? theme.colors.like : theme.colors.textMuted}
            weight={m.likedByMe ? "fill" : "regular"}
          />
          <Text style={styles.likeCount}>{m.likeCount}</Text>
        </Pressable>
      )}
      <Animated.View pointerEvents="none" style={[styles.heart, heartStyle]}>
        <icons.like size={HEART} color={theme.colors.like} weight="fill" />
      </Animated.View>
    </Pressable>
  );

  const more =
    web && showMenu && (hover || focused) ? (
      <Pressable
        onPress={showMenu}
        onFocus={focus}
        onBlur={blur}
        style={styles.more}
        accessibilityRole="button"
        accessibilityLabel={t("a11y.more")}
      >
        <icons.menu size={16} color={theme.colors.textMuted} weight="bold" />
      </Pressable>
    ) : null;

  const rowStyle = [styles.row, own ? styles.rowOwn : null];
  const content = (
    <>
      {!own && !last && <View style={styles.avatarSpace} />}
      {!own && last && (
        <Pressable
          onPress={() => onOpenProfile(m.authorId)}
          accessibilityRole="button"
          accessibilityLabel={author?.name}
        >
          <Avatar
            userId={m.authorId}
            name={author?.name ?? ""}
            url={author?.avatarUrl ?? null}
            size={AVATAR}
            placement="message"
            admin={author?.admin}
            handle={author?.handle ?? null}
            badges={author?.badges}
          />
        </Pressable>
      )}
      {/* The "…" follows the bubble in focus order; an own row is reversed, so it
          sits on the bubble's left. */}
      {bubble}
      {more}
    </>
  );
  // Web: the row tracks the hover, so the "…" stays while the pointer moves onto it.
  const row = web ? (
    <Pressable
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessible={false}
      focusable={false}
      style={rowStyle}
    >
      {content}
    </Pressable>
  ) : (
    <View style={rowStyle}>{content}</View>
  );
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        style={[
          first ? styles.runStart : styles.inRun,
          m.likeCount > 0 && !gone ? styles.rowLiked : null,
        ]}
      >
        {canReply && (
          <Animated.View pointerEvents="none" style={[styles.replyIcon, replyIconStyle]}>
            <icons.reply size={18} color={theme.colors.textMuted} weight="bold" />
          </Animated.View>
        )}
        <Animated.View style={swipeStyle}>{row}</Animated.View>
      </View>
    </GestureDetector>
  );
});

/** A message's photo: the local file while sending, else a signed URL (private
 * bucket). Opens full-screen on tap. */
function MessageImage({ message }: { message: ChatMessage }) {
  const cfg = useCommunityConfig();
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const openImage = useContext(ImageViewerContext);
  const path = message.imagePath!;
  const local = isOptimistic(message);
  const signed = useQuery({
    queryKey: ["community", "messageImage", path],
    queryFn: () => messageImageUrl(cfg, path),
    enabled: !local,
    staleTime: SIGNED_URL_STALE_MS,
  }).data;
  const url = local ? path : signed;
  const [size, setSize] = useState({ width: 1, height: 1 });
  return (
    <Pressable
      onPress={url ? () => openImage({ url, ...size }) : undefined}
      accessibilityRole="imagebutton"
      accessibilityLabel={t("a11y.openImage")}
      style={styles.imageWrap}
    >
      <Image
        source={url ? { uri: url } : null}
        style={[styles.image, { aspectRatio: imageRatio(size) }]}
        contentFit="cover"
        onLoad={(e) => setSize({ width: e.source.width, height: e.source.height })}
      />
    </Pressable>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: theme.spacing(1.5),
      paddingHorizontal: theme.spacing(3),
    },
    rowOwn: { flexDirection: "row-reverse" },
    // Runs sit apart; bubbles inside a run, close together.
    runStart: { marginTop: theme.spacing(2) },
    inRun: { marginTop: theme.spacing(0.5) },
    avatarSpace: { width: AVATAR },
    replyIcon: {
      position: "absolute",
      left: theme.spacing(3),
      top: 0,
      bottom: 0,
      justifyContent: "center",
    },
    heart: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    // Room for the like pill hanging under the bubble.
    rowLiked: { marginBottom: theme.spacing(3) },
    bubble: {
      maxWidth: "78%",
      paddingVertical: theme.spacing(1.75),
      paddingHorizontal: theme.spacing(2.5),
      borderRadius: theme.radius.md,
    },
    bubbleOwn: { backgroundColor: theme.colors.accent },
    bubbleOther: { backgroundColor: theme.colors.surfaceMuted },
    // The run's last bubble points at its author.
    tailOwn: { borderBottomRightRadius: theme.radius.sm / 2 },
    tailOther: { borderBottomLeftRadius: theme.radius.sm / 2 },
    sending: { opacity: 0.6 },
    name: {
      ...theme.typography.caption,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.accent,
      marginBottom: theme.spacing(0.5),
    },
    body: { ...theme.typography.bodySmall },
    deleted: { fontStyle: "italic", opacity: 0.6 },
    meta: {
      ...theme.typography.caption,
      fontSize: theme.typography.caption.fontSize - 2,
      opacity: 0.65,
      marginTop: theme.spacing(0.75),
      textAlign: "right",
    },
    link: { textAlign: "left", textDecorationLine: "underline" },
    like: {
      position: "absolute",
      bottom: -theme.spacing(2.5),
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(0.75),
      paddingHorizontal: theme.spacing(1.5),
      paddingVertical: theme.spacing(0.25),
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    likeOwn: { right: theme.spacing(1.5) },
    likeOther: { left: theme.spacing(1.5) },
    likeCount: {
      ...theme.typography.caption,
      fontSize: theme.typography.caption.fontSize - 2,
      color: theme.colors.textSecondary,
    },
    more: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
    },
    imageWrap: { marginBottom: theme.spacing(1) },
    image: {
      width: IMAGE_WIDTH,
      maxWidth: "100%",
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.hairline,
    },
  });
}
