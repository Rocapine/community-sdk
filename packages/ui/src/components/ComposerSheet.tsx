// Full-screen post composer, opened by the feed's `+` button (version A of
// the redesign, after Eve's `compose` screen and X): Cancel / Post on top, the
// author's avatar in a first column, then the name, the topic pill (tap → topic
// menu), the text field and the attached image or poll editor; a toolbar on
// top of the keyboard holds the photo and poll buttons and a character ring.
//
// The gates run before this opens (rules, then the host's `beforeCompose`, see
// `openComposerGuarded`), so a host gate that shows its own modal never has to
// stack on top of this one, which iOS cannot do.
//
// The draft lives in this component, not in the `Modal` (which unmounts its
// children while hidden): keep it mounted and a draft survives a close, so a
// failed publish puts the text back and it shows on the next `+`. A post
// carries a poll or an image, never both.

import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  useCommunityConfig,
  useCreatePost,
  useMyUid,
  useProfile,
  type LocalImage,
} from "@rocapine/community-core";
import { Image } from "expo-image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { imageFrame, imagesSupported, pickImage } from "../utils/postImage";
import { useMyAuthorName } from "../utils/myName";
import { Avatar } from "./Avatar";
import { haptic, PressableScale } from "./PressableScale";
import { noFocusRing } from "../utils/noFocusRing";

/** The Post pill's enabled state: text or an image, a valid poll (if any),
 * and no publish or photo pick/re-encode in flight (so the text can't go out
 * alone while its photo is still being prepared). `gating` is kept for hosts
 * that track their own in-flight check. */
export function canPublish(s: {
  text: string;
  image: LocalImage | null;
  pollInvalid: boolean;
  pending: boolean;
  gating: boolean;
  preparing: boolean;
}): boolean {
  return (
    (s.text.trim().length > 0 || s.image !== null) &&
    !s.pollInvalid &&
    !s.pending &&
    !s.gating &&
    !s.preparing
  );
}

const THUMB_MAX_WIDTH = 180;

export function ComposerSheet({
  visible,
  defaultTopic,
  renderComposerExtra,
  onClose,
  onModerationRejected,
  onPublishFailed,
}: {
  visible: boolean;
  /** Preselected when the sheet opens on an empty draft (the feed's tab when
   * it is a postable topic). */
  defaultTopic?: string;
  /** A host affordance added to the keyboard toolbar. */
  renderComposerExtra?: ReactNode;
  onClose(): void;
  /** A published post came back rejected by moderation. */
  onModerationRejected?: (kind: "post") => void;
  /** Publishing failed (network/server): the optimistic post rolled back and
   * the draft is back in the composer for the next `+`. */
  onPublishFailed?: () => void;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const createPost = useCreatePost();
  const myUid = useMyUid();
  const myAvatarUrl = useProfile(myUid).data?.avatarUrl ?? null;
  const myAuthorName = useMyAuthorName();

  const topics = cfg.composeTopics();
  const fallbackTopic = defaultTopic ?? topics[0]?.id ?? "general";
  const [topic, setTopic] = useState<string>(fallbackTopic);
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  // The topic menu floats over the sheet, anchored under the pill.
  const rootRef = useRef<View>(null);
  const pillRef = useRef<View>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const openTopicMenu = () => {
    const root = rootRef.current;
    if (!root || !pillRef.current) return;
    const pill = pillRef.current;
    // Both in window coordinates, then relative to the sheet (measureLayout
    // never calls back on react-native-web).
    root.measureInWindow((rootX, rootY) => {
      pill.measureInWindow((x, y, _w, h) => {
        setMenuAnchor({ x: x - rootX, y: y - rootY + h + 6 });
        setTopicMenuOpen(true);
      });
    });
  };
  const [text, setText] = useState("");
  // null = no poll on this draft; an array = the poll editor is open.
  const [pollDraft, setPollDraft] = useState<string[] | null>(null);
  const [image, setImage] = useState<LocalImage | null>(null);
  // True while a photo is picked and re-encoded (1–2 s for a large one).
  const [preparing, setPreparing] = useState(false);
  // Read by the async publish callbacks (the draft may have changed since).
  const latestDraft = useRef({ text, pollDraft, image });
  latestDraft.current = { text, pollDraft, image };
  const imagesOn = !!cfg.modules.images && imagesSupported();
  const keyboardHeight = useKeyboardHeight();
  const isEmpty = text.trim() === "" && pollDraft === null && image === null;

  // An empty draft follows the feed's tab each time the sheet opens.
  useEffect(() => {
    if (visible && latestDraft.current.text.trim() === "" && !latestDraft.current.image) {
      setTopic(fallbackTopic);
    }
    if (!visible) setTopicMenuOpen(false);
  }, [visible, fallbackTopic]);

  const filledPollOptions = (pollDraft ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
  const pollInvalid = pollDraft !== null && filledPollOptions.length < POLL_MIN_OPTIONS;
  const canPost = canPublish({
    text,
    image,
    pollInvalid,
    pending: createPost.isPending,
    gating: false,
    preparing,
  });

  const clearDraft = () => {
    setText("");
    setPollDraft(null);
    setImage(null);
  };

  const cancel = () => {
    if (isEmpty) {
      onClose();
      return;
    }
    Alert.alert(t("composer.discardTitle"), undefined, [
      { text: t("composer.keepEditing"), style: "cancel" },
      {
        text: t("composer.discard"),
        style: "destructive",
        onPress: () => {
          clearDraft();
          onClose();
        },
      },
    ]);
  };

  const attachImage = async () => {
    if (preparing) return;
    setPreparing(true);
    try {
      const picked = await pickImage();
      // Cancelled/failed: the draft (and any attached image) stays as it was.
      if (picked) setImage(picked);
    } finally {
      setPreparing(false);
    }
  };

  const togglePoll = () => {
    haptic("selection");
    setPollDraft((prev) => (prev === null ? ["", ""] : null));
  };

  const submit = () => {
    if (!canPost) return;
    const draft = {
      topic,
      body: text.trim(),
      pollOptions: pollDraft !== null ? filledPollOptions : undefined,
      image: image ?? undefined,
    };
    haptic("medium");
    Keyboard.dismiss();
    clearDraft();
    onClose();
    createPost.mutate(
      {
        topic,
        text: draft.body,
        authorName: myAuthorName(),
        pollOptions: draft.pollOptions,
        image: draft.image,
      },
      {
        onSuccess: (result) => {
          if (result.verdict.status === "rejected") onModerationRejected?.("post");
        },
        onError: () => {
          // Hand the draft (topic, text, poll and image together) back unless a new
          // one was started meanwhile.
          const now = latestDraft.current;
          if (!now.text.trim() && now.pollDraft === null && now.image === null) {
            setTopic(draft.topic);
            setText(draft.body);
            setPollDraft(draft.pollOptions ? [...draft.pollOptions] : null);
            setImage(draft.image ?? null);
          }
          onPublishFailed?.();
        },
      },
    );
  };

  const placeholder =
    pollDraft !== null ? t("composer.pollPlaceholder") : t("composer.placeholder");
  const topicLabel = t(`topics.${topic}`);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={cancel}
    >
      <View
        ref={rootRef}
        style={[styles.root, { paddingTop: Platform.OS === "android" ? insets.top : 0 }]}
      >
        <View style={styles.topBar}>
          <Pressable hitSlop={10} onPress={cancel} accessibilityRole="button">
            <Text style={styles.cancel}>{t("composer.cancel")}</Text>
          </Pressable>
          <PressableScale
            onPress={submit}
            disabled={!canPost}
            style={[styles.postBtn, !canPost && styles.postBtnDisabled]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canPost }}
          >
            <Text style={styles.postBtnLabel}>{t("composer.post")}</Text>
          </PressableScale>
        </View>

        <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.authorRow}>
              <Avatar userId={myUid} name={myAuthorName()} url={myAvatarUrl} size={40} />
              <View style={styles.main}>
                <Text style={styles.name} numberOfLines={1}>
                  {myAuthorName()}
                </Text>
                {topics.length > 1 && (
                  <View ref={pillRef} style={styles.topicPillWrap} collapsable={false}>
                    <PressableScale
                      onPress={openTopicMenu}
                      style={styles.topicPill}
                      accessibilityRole="button"
                      accessibilityLabel={`${t("composer.chooseTopic")} ${topicLabel}`}
                      accessibilityState={{ expanded: topicMenuOpen }}
                    >
                      <Text style={styles.topicPillText} numberOfLines={1}>
                        {topicLabel}
                      </Text>
                      <View style={topicMenuOpen ? styles.chevronUp : styles.chevronDown}>
                        <icons.back size={11} color={theme.colors.accent} weight="bold" />
                      </View>
                    </PressableScale>
                  </View>
                )}
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder={placeholder}
                  placeholderTextColor={theme.colors.textFaint}
                  accessibilityLabel={placeholder}
                  autoFocus
                  multiline
                  maxLength={cfg.postMaxLength}
                  scrollEnabled={false}
                  style={styles.input}
                />

                {image !== null && (
                  <View style={styles.thumbWrap}>
                    <Image
                      source={{ uri: image.url }}
                      style={[imageFrame(image, THUMB_MAX_WIDTH), styles.thumb]}
                      contentFit="cover"
                    />
                    <Pressable
                      hitSlop={10}
                      onPress={() => setImage(null)}
                      style={styles.thumbRemove}
                      accessibilityRole="button"
                      accessibilityLabel={t("composer.removeImage")}
                    >
                      <icons.close size={11} color="#FFFFFF" weight="bold" />
                    </Pressable>
                  </View>
                )}

                {cfg.modules.polls && pollDraft !== null && (
                  <View style={styles.pollEditor}>
                    {pollDraft.map((option, i) => (
                      <View key={i} style={styles.pollOptionRow}>
                        <TextInput
                          value={option}
                          onChangeText={(v) =>
                            setPollDraft((prev) =>
                              prev ? prev.map((o, j) => (j === i ? v : o)) : prev,
                            )
                          }
                          placeholder={t("composer.option", { number: i + 1 })}
                          placeholderTextColor={theme.colors.textFaint}
                          maxLength={POLL_OPTION_MAX_LENGTH}
                          // Long options wrap; Return ends the option, no newline.
                          multiline
                          scrollEnabled={false}
                          submitBehavior="blurAndSubmit"
                          style={styles.pollOptionInput}
                        />
                        {pollDraft.length > POLL_MIN_OPTIONS && (
                          <Pressable
                            hitSlop={8}
                            onPress={() =>
                              setPollDraft((prev) => (prev ? prev.filter((_, j) => j !== i) : prev))
                            }
                            accessibilityRole="button"
                            accessibilityLabel={t("composer.removeOption")}
                          >
                            <icons.close size={16} color={theme.colors.textFaint} weight="bold" />
                          </Pressable>
                        )}
                      </View>
                    ))}
                    {pollDraft.length < POLL_MAX_OPTIONS && (
                      <Pressable
                        onPress={() => setPollDraft((prev) => (prev ? [...prev, ""] : prev))}
                        style={styles.pollAdd}
                      >
                        <icons.add size={14} color={theme.colors.accent} weight="bold" />
                        <Text style={styles.pollAddText}>{t("composer.addOption")}</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            </View>
          </ScrollView>

          <View
            style={[
              styles.toolbar,
              { paddingBottom: theme.spacing(2) + (keyboardHeight > 0 ? 0 : insets.bottom) },
            ]}
          >
            {imagesOn && (
              <Pressable
                onPress={attachImage}
                disabled={preparing || pollDraft !== null}
                hitSlop={6}
                style={styles.tool}
                accessibilityRole="button"
                accessibilityLabel={t("composer.addImage")}
                accessibilityState={{ busy: preparing, disabled: pollDraft !== null }}
              >
                {preparing ? (
                  <ActivityIndicator size="small" color={theme.colors.accent} />
                ) : (
                  <icons.image
                    size={22}
                    color={pollDraft !== null ? theme.colors.textFaint : theme.colors.accent}
                    weight="regular"
                  />
                )}
              </Pressable>
            )}
            {cfg.modules.polls && (
              <Pressable
                onPress={togglePoll}
                disabled={image !== null}
                hitSlop={6}
                style={styles.tool}
                accessibilityRole="button"
                accessibilityLabel={
                  pollDraft !== null ? t("composer.removePoll") : t("composer.poll")
                }
                accessibilityState={{ disabled: image !== null, selected: pollDraft !== null }}
              >
                <icons.poll
                  size={22}
                  color={image !== null ? theme.colors.textFaint : theme.colors.accent}
                  weight={pollDraft !== null ? "fill" : "regular"}
                />
              </Pressable>
            )}
            {renderComposerExtra}
            <View style={styles.toolbarEnd}>
              <CharRing used={text.length} max={cfg.postMaxLength} />
            </View>
          </View>
        </View>
        {topicMenuOpen && menuAnchor && (
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setTopicMenuOpen(false)}
              accessibilityRole="button"
              accessibilityLabel={t("composer.cancel")}
            />
            <View style={[styles.topicMenu, { top: menuAnchor.y, left: menuAnchor.x }]}>
              <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
                {topics.map((option) => {
                  const on = topic === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => {
                        if (!on) haptic("selection");
                        setTopic(option.id);
                        setTopicMenuOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.topicRow,
                        (on || pressed) && styles.topicRowOn,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.topicRowLabel, on && styles.topicRowLabelOn]}>
                        {t(`topics.${option.id}`)}
                      </Text>
                      {on && (
                        <icons.checkmark size={16} color={theme.colors.accent} weight="fill" />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

/** iOS: the keyboard's height, so the toolbar rides on top of it. The page
 * sheet's bottom is the screen's bottom, so the height is the offset as is
 * (`KeyboardAvoidingView` measures against the sheet's frame and comes out
 * short there). Android resizes the Modal's window itself: 0. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", (e) =>
      setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

const RING_SIZE = 22;
const RING_STROKE = 2.5;
/** Remaining characters at which the ring shows its count and turns red. */
const RING_WARN = 20;

/** X's character ring, drawn with plain Views (the SDK takes no SVG
 * dependency): two clipped halves, each rotating a half-circle border in. */
function CharRing({ used, max }: { used: number; max: number }) {
  const theme = useCommunityTheme();
  const styles = useThemedStyles(makeStyles);
  const remaining = max - used;
  const deg = Math.min(1, used / max) * 360;
  const color = remaining <= RING_WARN ? theme.colors.danger : theme.colors.accent;
  const arc = { borderTopColor: color, borderRightColor: color };
  return (
    <View style={styles.ringRow} accessible accessibilityLabel={`${remaining}`}>
      {remaining <= RING_WARN && <Text style={[styles.ringCount, { color }]}>{remaining}</Text>}
      <View style={styles.ring}>
        <View style={[styles.ringHalf, styles.ringRight]}>
          <View
            style={[
              styles.ringArc,
              styles.ringArcInRight,
              arc,
              { transform: [{ rotate: `${-135 + Math.min(deg, 180)}deg` }] },
            ]}
          />
        </View>
        <View style={[styles.ringHalf, styles.ringLeft]}>
          <View
            style={[
              styles.ringArc,
              arc,
              { transform: [{ rotate: `${45 + Math.max(deg - 180, 0)}deg` }] },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const makeStyles = (theme: CommunityTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    flex: { flex: 1 },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.hairline,
    },
    cancel: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 16,
      color: theme.colors.textPrimary,
    },
    postBtn: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.pill,
      height: 34,
      justifyContent: "center",
      paddingHorizontal: theme.spacing(4.5),
    },
    // Dimmed rather than recolored: stays visible on any background.
    postBtnDisabled: { opacity: 0.4 },
    postBtnLabel: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 14,
      color: theme.colors.textInverse,
    },
    content: { padding: theme.spacing(4) },
    authorRow: { flexDirection: "row", gap: theme.spacing(3) },
    main: { flex: 1, minWidth: 0 },
    name: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 15,
      color: theme.colors.textPrimary,
    },
    topicPill: {
      alignSelf: "flex-start",
      maxWidth: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1.5),
      marginTop: theme.spacing(1.5),
      paddingHorizontal: theme.spacing(3),
      height: 28,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.accentSoft,
    },
    topicPillText: {
      flexShrink: 1,
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13,
      color: theme.colors.accent,
    },
    chevronDown: { transform: [{ rotate: "-90deg" }] },
    chevronUp: { transform: [{ rotate: "90deg" }] },
    topicPillWrap: { alignSelf: "flex-start", maxWidth: "100%" },
    // Floats over the sheet (a select), under the pill.
    topicMenu: {
      position: "absolute",
      minWidth: 220,
      maxWidth: 300,
      maxHeight: 320,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      overflow: "hidden",
      ...theme.shadow,
    },
    topicRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 44,
      paddingHorizontal: theme.spacing(3.5),
    },
    topicRowOn: { backgroundColor: theme.colors.surfaceMuted },
    topicRowLabel: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 14.5,
      color: theme.colors.textSecondary,
    },
    topicRowLabelOn: { color: theme.colors.textPrimary },
    input: {
      marginTop: theme.spacing(2.5),
      minHeight: 120,
      padding: 0,
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 16,
      lineHeight: 23,
      color: theme.colors.textPrimary,
      textAlignVertical: "top",
      ...noFocusRing,
    },
    thumbWrap: { alignSelf: "flex-start", marginTop: theme.spacing(3) },
    thumb: { borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceMuted },
    thumbRemove: {
      position: "absolute",
      top: theme.spacing(1.5),
      right: theme.spacing(1.5),
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "rgba(0,0,0,0.6)",
      alignItems: "center",
      justifyContent: "center",
    },
    pollEditor: { marginTop: theme.spacing(3), gap: theme.spacing(2) },
    pollOptionRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2.5) },
    pollOptionInput: {
      flex: 1,
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing(3.5),
      paddingVertical: theme.spacing(2.75),
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 14,
      color: theme.colors.textPrimary,
      ...noFocusRing,
    },
    pollAdd: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1.5),
      paddingVertical: theme.spacing(1.5),
    },
    pollAddText: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13,
      color: theme.colors.accent,
    },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingHorizontal: theme.spacing(3),
      paddingTop: theme.spacing(2),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.hairline,
      backgroundColor: theme.colors.background,
    },
    tool: { width: 40, height: 36, alignItems: "center", justifyContent: "center" },
    toolbarEnd: { marginLeft: "auto", paddingRight: theme.spacing(1) },
    ringRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
    ringCount: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
    },
    ring: {
      width: RING_SIZE,
      height: RING_SIZE,
      borderRadius: RING_SIZE / 2,
      borderWidth: RING_STROKE,
      borderColor: theme.colors.hairline,
    },
    // Each half clips one rotating half-circle; both sit over the track.
    ringHalf: {
      position: "absolute",
      top: -RING_STROKE,
      width: RING_SIZE / 2,
      height: RING_SIZE,
      overflow: "hidden",
    },
    ringRight: { left: RING_SIZE / 2 - RING_STROKE },
    ringLeft: { left: -RING_STROKE },
    ringArc: {
      position: "absolute",
      top: 0,
      left: 0,
      width: RING_SIZE,
      height: RING_SIZE,
      borderRadius: RING_SIZE / 2,
      borderWidth: RING_STROKE,
      borderColor: "transparent",
    },
    ringArcInRight: { left: -RING_SIZE / 2 },
  });
