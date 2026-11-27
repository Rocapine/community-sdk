// One chat message (validated mockup "bubbles"): mine on the right in the accent
// color, others' on the left. Consecutive messages by one author form a run: the
// name (groups) on its first bubble, the avatar and the tail corner on its last. A
// reply quotes its target inside the bubble; likes sit in a pill on the bubble's edge.
//
// Gestures: a double tap on the bubble (double click on web) likes or unlikes, with a
// small heart pop; taps on the like pill, the quote or a card stay theirs. A photo's
// single tap opens the viewer only once the double tap has failed, so a double tap on
// a photo never opens it. A swipe right (native only) replies: the bubble follows the
// finger a little, a reply icon shows, a haptic marks the threshold. Vertical moves
// stay the list's (`touch-action: pan-y` on web), and touches at the screen's left
// edge stay the system's back swipe. The menu (long press, right click or the "…" on
// hover or focus on web) keeps Like and Reply, and screen readers get both as actions.
// Web: no text selection in bubbles (a double click would select a word); the menu's
// Copy copies the text.
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
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
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
import { formatClock } from "../../utils/chat";
import {
  SWIPE_ARMED_OFFSET,
  SWIPE_MAX,
  hitsControl,
  type Rect,
  startsAtEdge,
  swipeOffset,
  swipeTriggered,
} from "../../utils/chatGestures";
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
/** The double tap's window between taps (ms): a photo's single tap waits this long. */
const DOUBLE_TAP_MS = 300;
/** The like pill's hitSlop, also around the controls a double tap leaves alone. */
const CONTROL_SLOP = 6;

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
  // Where the bubble's own controls sit (layout relative to the bubble), so a tap on
  // them never counts toward a double tap; null while not shown.
  const pillRect = useSharedValue<Rect | null>(null);
  const quoteRect = useSharedValue<Rect | null>(null);
  const cardRect = useSharedValue<Rect | null>(null);
  const showPill = m.likeCount > 0 && !gone;
  const showQuote = !!m.replyTo && !gone;
  const showCard = !!m.attachment && !gone;
  useEffect(() => {
    if (!showPill) pillRect.value = null;
    if (!showQuote) quoteRect.value = null;
    if (!showCard) cardRect.value = null;
  }, [showPill, showQuote, showCard, pillRect, quoteRect, cardRect]);
  const measure = (rect: typeof pillRect) => (e: LayoutChangeEvent) => {
    rect.value = e.nativeEvent.layout;
  };
  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(DOUBLE_TAP_MS)
        .enabled(canLike)
        .onTouchesDown((e, manager) => {
          "worklet";
          const touch = e.changedTouches[0];
          if (
            touch &&
            hitsControl(
              touch.x,
              touch.y,
              [pillRect.value, quoteRect.value, cardRect.value],
              CONTROL_SLOP,
            )
          )
            manager.fail();
        })
        .onEnd((_e, success) => {
          "worklet";
          if (success) runOnJS(like)();
        }),
    [canLike, like, pillRect, quoteRect, cardRect],
  );
  const pan = useMemo(() => {
    return (
      Gesture.Pan()
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
        .onEnd((e, success) => {
          "worklet";
          if (success && swipeTriggered(e.translationX)) runOnJS(reply)();
        })
        .onFinalize(() => {
          "worklet";
          armed.value = false;
          swipe.value = reduceMotion
            ? withTiming(0, { duration: 150 })
            : withSpring(0, { damping: 20, stiffness: 260 });
        })
    );
  }, [canReply, reduceMotion, reply, tick, swipe, armed]);
  const swipeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: swipe.value }] }));
  const replyIconStyle = useAnimatedStyle(() => ({
    // Fully shown when the swipe arms (the haptic), not only at the bubble's maximum.
    opacity: interpolate(
      swipe.value,
      [SWIPE_ARMED_OFFSET / 3, SWIPE_ARMED_OFFSET],
      [0, 1],
      "clamp",
    ),
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

  // The double tap covers the bubble only (not the avatar); `userSelect` and
  // `touchAction` are web-only: no word selection, and vertical touch scrolling stays.
  const bubble = (
    <GestureDetector gesture={doubleTap} userSelect="none" touchAction="pan-y">
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
              <View onLayout={measure(quoteRect)}>
                <QuoteBlock
                  replyTo={m.replyTo}
                  color={textColor}
                  onPress={() => onPressQuote(m.replyTo!.id)}
                />
              </View>
            )}
            {m.imagePath && <MessageImage message={m} doubleTap={canLike ? doubleTap : null} />}
            {m.attachment && (
              <View onLayout={measure(cardRect)}>
                <AttachmentCard
                  attachment={m.attachment}
                  placement="message"
                  variant="compact"
                  onOpen={onOpenAttachment}
                />
              </View>
            )}
            {!!(translation ?? m.body) && (
              <Text style={[styles.body, { color: textColor }]}>{translation ?? m.body}</Text>
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
        {showPill && (
          <Pressable
            onPress={onToggleLike ? () => onToggleLike(m) : undefined}
            onLayout={measure(pillRect)}
            disabled={!onToggleLike}
            hitSlop={CONTROL_SLOP}
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
        {/* Decoration only: screen readers read the like from the pill and the actions. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.heart, heartStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
        >
          <icons.like size={HEART} color={theme.colors.like} weight="fill" />
        </Animated.View>
      </Pressable>
    </GestureDetector>
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
    <GestureDetector gesture={pan} touchAction="pan-y">
      <View
        collapsable={false}
        style={[first ? styles.runStart : styles.inRun, showPill ? styles.rowLiked : null]}
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
 * bucket). Opens full-screen on a single tap, once the bubble's `doubleTap` failed
 * (a double tap likes instead); screen readers and the web keyboard open it at once. */
function MessageImage({
  message,
  doubleTap,
}: {
  message: ChatMessage;
  doubleTap: GestureType | null;
}) {
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
  const latestOpen = useRef<(() => void) | undefined>(undefined);
  latestOpen.current = url ? () => openImage({ url, ...size }) : undefined;
  const open = useCallback(() => latestOpen.current?.(), []);
  const tap = useMemo(() => {
    const single = Gesture.Tap().onEnd((_e, success) => {
      "worklet";
      if (success) runOnJS(open)();
    });
    // The bubble's double tap sits in the outer detector: Exclusive(doubleTap, single)
    // across detectors.
    return doubleTap ? single.requireExternalGestureToFail(doubleTap) : single;
  }, [doubleTap, open]);
  // Web keyboard: Enter or Space opens it (a focusable View, no Pressable whose click
  // would open on a double click's first click). Typed loosely: react-native-web hands
  // the DOM keyboard event, not React Native's.
  const keyboard: object = web
    ? {
        focusable: true,
        onKeyDown: (e: { key: string; preventDefault(): void }) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          open();
        },
      }
    : {};
  return (
    <GestureDetector gesture={tap} touchAction="pan-y">
      <View
        accessible
        accessibilityRole="imagebutton"
        accessibilityLabel={t("a11y.openImage")}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={open}
        collapsable={false}
        style={[styles.imageWrap, web && styles.pointer]}
        {...keyboard}
      >
        <Image
          source={url ? { uri: url } : null}
          style={[styles.image, { aspectRatio: imageRatio(size) }]}
          contentFit="cover"
          onLoad={(e) => setSize({ width: e.source.width, height: e.source.height })}
        />
      </View>
    </GestureDetector>
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
    pointer: { cursor: "pointer" },
    image: {
      width: IMAGE_WIDTH,
      maxWidth: "100%",
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.hairline,
    },
  });
}
