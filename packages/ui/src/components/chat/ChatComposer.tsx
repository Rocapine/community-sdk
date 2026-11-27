// The chat's input bar: an optional photo button, the field, send. Above it, the
// message being answered ("Replying to Ana" over its first line) or edited, with a
// cancel button, the picked photo and the last send error. The screen owns the state.
import type { LocalImage } from "@rocapine/community-core";
import { Image } from "expo-image";
import type { Ref } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
} from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../../ThemeProvider";
import type { CommunityTheme } from "../../theme";
import { noFocusRingMultiline } from "../../utils/noFocusRing";

const THUMB = 56;
const SEND = 36;

export function ChatComposer({
  inputRef,
  text,
  onChangeText,
  maxLength,
  image,
  preparing,
  onPickImage,
  onRemoveImage,
  banner,
  onCancelBanner,
  error,
  canSend,
  onSend,
}: {
  inputRef: Ref<TextInputInstance>;
  text: string;
  onChangeText(text: string): void;
  maxLength: number;
  image: LocalImage | null;
  /** A photo is being picked and re-encoded. */
  preparing: boolean;
  /** Absent: no photo button. */
  onPickImage?(): void;
  onRemoveImage(): void;
  /** "Replying to Marc" / "Editing message", with a cancel button; `detail`, one
   * ellipsized line under it (the replied message's first line, or "📷 Photo"). */
  banner: { title: string; detail?: string | null } | null;
  onCancelBanner(): void;
  error: string | null;
  canSend: boolean;
  onSend(): void;
}) {
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.root}>
      {banner && (
        <View style={styles.banner}>
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle} numberOfLines={1}>
              {banner.title}
            </Text>
            {!!banner.detail && (
              <Text style={styles.bannerDetail} numberOfLines={1}>
                {banner.detail}
              </Text>
            )}
          </View>
          <Pressable
            onPress={onCancelBanner}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("menu.cancel")}
          >
            <icons.close size={14} color={theme.colors.textMuted} weight="bold" />
          </Pressable>
        </View>
      )}
      {error && (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      {(image || preparing) && (
        <View style={styles.thumbWrap}>
          {image ? (
            <Image source={{ uri: image.url }} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbLoading]}>
              <ActivityIndicator color={theme.colors.accent} />
            </View>
          )}
          {image && (
            <Pressable
              onPress={onRemoveImage}
              hitSlop={10}
              style={styles.thumbRemove}
              accessibilityRole="button"
              accessibilityLabel={t("composer.removeImage")}
            >
              <icons.close size={10} color={theme.colors.textInverse} weight="bold" />
            </Pressable>
          )}
        </View>
      )}
      <View style={styles.bar}>
        {onPickImage && (
          <Pressable
            onPress={onPickImage}
            disabled={preparing}
            hitSlop={6}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t("composer.addImage")}
          >
            <icons.image size={22} color={theme.colors.textMuted} weight="regular" />
          </Pressable>
        )}
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={onChangeText}
          placeholder={t("chat.placeholder")}
          placeholderTextColor={theme.colors.textFaint}
          maxLength={maxLength}
          multiline
          style={styles.input}
        />
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          style={[styles.send, !canSend && styles.sendOff]}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.send")}
          accessibilityState={{ disabled: !canSend }}
        >
          <icons.send size={16} color={theme.colors.textInverse} weight="fill" />
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    root: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.hairline,
      paddingTop: theme.spacing(2),
      paddingHorizontal: theme.spacing(3),
      gap: theme.spacing(1.5),
    },
    banner: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
    bannerText: {
      flex: 1,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.accent,
      paddingLeft: theme.spacing(2),
    },
    bannerTitle: {
      ...theme.typography.caption,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.accent,
    },
    bannerDetail: { ...theme.typography.caption, color: theme.colors.textMuted },
    error: { ...theme.typography.caption, color: theme.colors.danger },
    thumbWrap: { alignSelf: "flex-start" },
    thumb: { width: THUMB, height: THUMB, borderRadius: theme.radius.sm },
    thumbLoading: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceMuted,
    },
    thumbRemove: {
      position: "absolute",
      top: -theme.spacing(1.5),
      right: -theme.spacing(1.5),
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.textPrimary,
    },
    bar: { flexDirection: "row", alignItems: "flex-end", gap: theme.spacing(2) },
    iconButton: { height: SEND, justifyContent: "center" },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: SEND,
      borderRadius: SEND / 2,
      backgroundColor: theme.colors.surfaceMuted,
      paddingHorizontal: theme.spacing(3.5),
      paddingTop: theme.spacing(2),
      paddingBottom: theme.spacing(2),
      ...theme.typography.input,
      color: theme.colors.textPrimary,
      ...noFocusRingMultiline,
    },
    send: {
      width: SEND,
      height: SEND,
      borderRadius: SEND / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
    },
    sendOff: { opacity: 0.4 },
  });
}
