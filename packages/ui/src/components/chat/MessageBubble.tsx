// One chat message (validated mockup "bubbles"): mine on the right in the accent
// color, others' on the left with their avatar and, in a group, their name. A reply
// quotes its target inside the bubble; likes sit in a pill on the bubble's edge.
// The menu opens on a long press, a right click (web) or the "…" shown on hover or
// focus (web).
import {
  messageImageUrl,
  useCommunityConfig,
  useProfile,
  type ChatMessage,
  type PostAttachment,
} from "@rocapine/community-core";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useContext, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../../ThemeProvider";
import type { CommunityTheme } from "../../theme";
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

export const isOptimisticMessage = (m: ChatMessage) => m.id.startsWith("optimistic-");

export function MessageBubble({
  message: m,
  own,
  showName,
  translation,
  onShowOriginal,
  onMenu,
  onToggleLike,
  onOpenProfile,
  onPressQuote,
  onOpenAttachment,
}: {
  message: ChatMessage;
  own: boolean;
  /** The author's name above the bubble (groups, others' messages). */
  showName: boolean;
  /** The on-demand translation, shown in place of the text. */
  translation?: string;
  onShowOriginal?(): void;
  /** Absent: no menu (a message being sent, or deleted). */
  onMenu?(m: ChatMessage): void;
  /** Absent: the like pill only shows the count. */
  onToggleLike?(m: ChatMessage): void;
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
  const deleted = m.status === "deleted";
  const textColor = own ? theme.colors.textInverse : theme.colors.textPrimary;
  const openMenu = onMenu
    ? () => {
        haptic("light");
        onMenu(m);
      }
    : undefined;
  // Web only: the browser's own menu gives way to ours.
  const contextMenu =
    web && onMenu
      ? {
          onContextMenu: (e: { preventDefault(): void }) => {
            e.preventDefault();
            onMenu(m);
          },
        }
      : {};

  let time = "";
  try {
    time = new Date(m.createdAt).toLocaleTimeString(cfg.host.getLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    // An invalid host locale: no time rather than a crash.
  }
  const meta = m.editedAt && !deleted ? `${time} · ${t("chat.edited")}` : time;

  const bubble = (
    <Pressable
      onLongPress={openMenu}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={[
        styles.bubble,
        own ? styles.bubbleOwn : styles.bubbleOther,
        (isOptimisticMessage(m) || m.status === "pending") && styles.sending,
      ]}
      accessibilityActions={onMenu ? [{ name: "longpress" }] : undefined}
      onAccessibilityAction={openMenu}
      {...contextMenu}
    >
      {showName && author && (
        <Text style={styles.name} numberOfLines={1}>
          {author.name}
        </Text>
      )}
      {deleted ? (
        <Text style={[styles.body, styles.deleted, { color: textColor }]}>
          {m.deletedBy === "creator" ? t("chat.deletedByCreator") : t("chat.deleted")}
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
              onPress={onShowOriginal}
              accessibilityRole="button"
            >
              {t("translation.showOriginal")}
            </Text>
          )}
        </>
      )}
      <Text style={[styles.meta, { color: textColor }]}>{meta}</Text>
      {m.likeCount > 0 && !deleted && (
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
    </Pressable>
  );

  const more =
    web && onMenu && hover ? (
      <Pressable
        onPress={() => onMenu(m)}
        style={styles.more}
        accessibilityRole="button"
        accessibilityLabel={t("a11y.more")}
      >
        <icons.menu size={16} color={theme.colors.textMuted} weight="bold" />
      </Pressable>
    ) : null;

  const rowStyle = [
    styles.row,
    own ? styles.rowOwn : null,
    m.likeCount > 0 && !deleted ? styles.rowLiked : null,
  ];
  const content = (
    <>
      {!own && (
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
      {own && more}
      {bubble}
      {!own && more}
    </>
  );
  // Web: the row tracks the hover, so the "…" stays while the pointer moves onto it.
  return web ? (
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
}

/** A message's photo: the local file while sending, else a signed URL (private
 * bucket). Opens full-screen on tap. */
function MessageImage({ message }: { message: ChatMessage }) {
  const cfg = useCommunityConfig();
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const openImage = useContext(ImageViewerContext);
  const path = message.imagePath!;
  const local = isOptimisticMessage(message);
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
      marginVertical: theme.spacing(0.75),
    },
    rowOwn: { justifyContent: "flex-end" },
    // Room for the like pill hanging under the bubble.
    rowLiked: { marginBottom: theme.spacing(3) },
    bubble: {
      maxWidth: "78%",
      paddingVertical: theme.spacing(1.75),
      paddingHorizontal: theme.spacing(2.5),
      borderRadius: theme.radius.md,
    },
    bubbleOwn: {
      backgroundColor: theme.colors.accent,
      borderBottomRightRadius: theme.radius.sm / 2,
    },
    bubbleOther: {
      backgroundColor: theme.colors.surfaceMuted,
      borderBottomLeftRadius: theme.radius.sm / 2,
    },
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
