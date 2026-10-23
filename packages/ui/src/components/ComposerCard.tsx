// Inline feed composer: a growing text field, optional poll and a POST pill.
// Ported from Eve's Rhythm's `ComposerCard` (`components/app/community/ComposerCard.tsx`
// — newer than the mold, which had no separate composer component at all).
//
// Differences from the Eve source, per the task brief's exported signature
// `{ defaultTopic?, renderComposerExtra? }`:
//  - No `locked`/`onLockedPress`/`pending`/`onSubmit` props: this card now
//    owns all of that itself — `pending` from `useCreatePost().isPending`,
//    `onSubmit` folded into its own `submit()`, and the rules-acceptance gate
//    read from `cfg.host.rulesAcceptance.get()` on mount into local state
//    (no store — Task 2's host adapter is the only source of truth) and
//    re-opened via its own embedded `RulesSheet` when the locked overlay is
//    tapped.
//  - `ComposerCardHandle` (`focus()`) via `forwardRef`, same as the Eve
//    source: the feed's floating compose bar scrolls back up and calls it.
//    A locked card opens the rules gate instead of focusing.
//  - Topic chips are config-driven (`cfg.composeTopics()`, labeled
//    `t("topics."+id)`) instead of the app's static `COMPOSE_TOPICS` list.
//  - The poll toggle + editor only render when `cfg.modules.polls` is on.
//  - New `renderComposerExtra` slot (a plain `ReactNode`, not a render-prop)
//    for a host to add its own footer affordance (e.g. an attach button)
//    without forking this file — rendered between the poll toggle and the
//    POST pill.
//
// No topic chips (they duplicated the feed's filter row and shifted the
// layout): while composing, the field grows downwards and a topic select sits
// in its bottom-right corner, preset to the feed's current topic.
//
// `onModerationRejected` (added in Task 12's review round, cross-file touch
// explicitly authorized there): this card's own `createPost.mutate(...)` call
// originally had no success/error callback at all, so `CommunityFeedScreen`
// had no signal to show a `NoticeCard` on a rejected post — the mold/Eve both
// show one. `onPublishFailed` covers the network/server case: the optimistic
// post rolls back (`useCreatePost`'s own `onError`), the draft is put back
// into the field and the host is told, so it can show its notice (Eve source
// showed one; silently losing the typed text was a regression).

import {
  displayName,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POST_MAX_LENGTH,
  useCommunityConfig,
  useCreatePost,
} from "@rocapine/community-core";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CommunitySheet, SheetScrollView } from "../Sheet";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { runGuarded } from "../utils/gate";
import { useRulesAccepted } from "../utils/rulesAcceptance";
import { AnimatedHeight } from "./AnimatedHeight";
import { haptic, PressableScale } from "./PressableScale";
import { RulesSheet } from "./RulesSheet";

type ComposerCardProps = {
  defaultTopic?: string;
  renderComposerExtra?: ReactNode;
  /** Called when a submitted post's moderation verdict comes back rejected —
   * a host can use this to show its own `NoticeCard`. */
  onModerationRejected?: (kind: "post") => void;
  /** Called when publishing fails (network/server error). The optimistic
   * post is rolled back and the draft is put back into the field, so a host
   * only needs to tell the user (e.g. a "network" `NoticeCard`). */
  onPublishFailed?: () => void;
  /** Awaited before the post is actually created (`useCreatePost().mutate`).
   * Absent ⇒ byte-identical behavior. Resolving/returning `false` (or
   * throwing) aborts the submit silently — no mutation, no error UI, and the
   * draft (text, poll options) is kept exactly as typed. Meant for a host-side
   * async gate, e.g. a paywall that resolves once the user is entitled. */
  beforeSubmit?: (draft: {
    topic: string;
    body: string;
    pollOptions?: string[];
  }) => Promise<boolean>;
};

export interface ComposerCardHandle {
  /** Focuses the text field, or opens the rules gate while still locked. */
  focus(): void;
}

export const ComposerCard = forwardRef<ComposerCardHandle, ComposerCardProps>(function ComposerCard(
  { defaultTopic, renderComposerExtra, onModerationRejected, onPublishFailed, beforeSubmit },
  ref,
) {
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);
  const createPost = useCreatePost();

  const topics = cfg.composeTopics();
  const fallbackTopic = defaultTopic ?? topics[0]?.id ?? "general";
  const [topic, setTopic] = useState<string>(fallbackTopic);
  // Follows the feed's filter: a post goes to the topic being browsed.
  useEffect(() => setTopic(fallbackTopic), [fallbackTopic]);
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  // Keeps the field expanded from the picker's opening until the field is
  // focused again, so closing the sheet doesn't collapse then re-expand it.
  const [holdExpanded, setHoldExpanded] = useState(false);
  const [text, setText] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  // null = no poll on this draft; an array = the poll editor is open.
  const [pollDraft, setPollDraft] = useState<string[] | null>(null);
  // Read by the async publish callbacks (the draft may have changed since).
  const latestDraft = useRef({ text, pollDraft });
  latestDraft.current = { text, pollDraft };

  // Rules gate: the shared in-memory mirror of `cfg.host.rulesAcceptance`
  // (see utils/rulesAcceptance.ts) — locked until the adapter answers, and
  // unlocked by ANY `RulesSheet` in the app, not just the one embedded below.
  const accepted = useRulesAccepted(cfg);
  const [rulesVisible, setRulesVisible] = useState(false);

  const locked = !accepted;
  const openRulesGate = () => setRulesVisible(true);

  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({
    focus: () => (locked ? openRulesGate() : inputRef.current?.focus()),
  }));

  // Like a plain post: adding a poll alone doesn't expand the field.
  const composing = inputFocused || holdExpanded || text.trim().length > 0;

  const filledPollOptions = (pollDraft ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
  const pollInvalid = pollDraft !== null && filledPollOptions.length < POLL_MIN_OPTIONS;
  const pending = createPost.isPending;
  // `gating`: true while a `beforeSubmit` promise is in flight — a plain
  // double-submit latch, since `pending` (from `createPost.isPending`) only
  // flips true once `.mutate(...)` actually starts, which happens after the
  // gate resolves. Without this, a second tap during the await could invoke
  // `beforeSubmit` a second time concurrently.
  const [gating, setGating] = useState(false);
  const canPost = text.trim().length > 0 && !pollInvalid && !pending && !gating;

  const openTopicPicker = () => {
    // The keyboard would cover the sheet; the field is refocused on dismiss.
    setHoldExpanded(true);
    Keyboard.dismiss();
    setTopicPickerOpen(true);
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
    };

    const doSubmit = () => {
      // Read after the gate: a host may set the display name in `beforeSubmit`.
      const authorName = displayName(cfg.host.getDisplayName(), cfg.authorFallback());
      haptic("medium");
      createPost.mutate(
        {
          topic,
          text: draft.body,
          authorName,
          pollOptions: draft.pollOptions,
        },
        {
          onSuccess: (result) => {
            if (result.verdict.status === "rejected") onModerationRejected?.("post");
          },
          onError: () => {
            // Hand the draft (text + poll together) back unless a new one
            // was started meanwhile.
            const now = latestDraft.current;
            if (!now.text.trim() && now.pollDraft === null) {
              setText(draft.body);
              setPollDraft(draft.pollOptions ? [...draft.pollOptions] : null);
            }
            onPublishFailed?.();
          },
        },
      );
      setText("");
      setPollDraft(null);
      Keyboard.dismiss();
    };

    if (!beforeSubmit) {
      doSubmit();
      return;
    }
    setGating(true);
    runGuarded(beforeSubmit, draft, doSubmit).finally(() => setGating(false));
  };

  const placeholder =
    pollDraft !== null ? t("composer.pollPlaceholder") : t("composer.placeholder");

  return (
    <View style={styles.card}>
      <AnimatedHeight>
        <View style={styles.inputBox}>
          {/* Our own placeholder: iOS doesn't re-lay the native one when it
              changes while focused (poll toggle), leaving it off-center. */}
          {text.length === 0 && (
            <Text
              style={[styles.input, styles.placeholder]}
              pointerEvents="none"
              // The field itself announces it (accessibilityLabel).
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {placeholder}
            </Text>
          )}
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onFocus={() => {
              setInputFocused(true);
              setHoldExpanded(false);
            }}
            onBlur={() => setInputFocused(false)}
            accessibilityLabel={placeholder}
            multiline
            maxLength={POST_MAX_LENGTH}
            style={[styles.input, composing && styles.inputComposing]}
          />
          {composing && topics.length > 1 && (
            <PressableScale
              onPress={openTopicPicker}
              style={styles.topicSelect}
              accessibilityRole="button"
              accessibilityLabel={`${t("composer.chooseTopic")} ${t(`topics.${topic}`)}`}
            >
              <Text style={styles.topicSelectText} numberOfLines={1}>
                {t(`topics.${topic}`)}
              </Text>
              <View style={styles.chevron}>
                <icons.back size={12} color={theme.colors.textMuted} weight="bold" />
              </View>
            </PressableScale>
          )}
        </View>
      </AnimatedHeight>

      {cfg.modules.polls && pollDraft !== null && (
        <View style={styles.pollEditor}>
          {pollDraft.map((option, i) => (
            <View key={i} style={styles.pollOptionRow}>
              <TextInput
                value={option}
                onChangeText={(v) =>
                  setPollDraft((prev) => (prev ? prev.map((o, j) => (j === i ? v : o)) : prev))
                }
                placeholder={t("composer.option", { number: i + 1 })}
                placeholderTextColor={theme.colors.textFaint}
                maxLength={POLL_OPTION_MAX_LENGTH}
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

      <View style={styles.footer}>
        {cfg.modules.polls && (
          <Pressable onPress={togglePoll} hitSlop={6} style={styles.pollToggle}>
            <icons.poll size={18} color={theme.colors.accent} weight="regular" />
            <Text style={styles.pollToggleText}>
              {pollDraft !== null ? t("composer.removePoll") : t("composer.poll")}
            </Text>
          </Pressable>
        )}
        {renderComposerExtra}
        <PressableScale
          onPress={submit}
          disabled={!canPost}
          style={[styles.postBtn, !canPost && styles.postBtnDisabled]}
        >
          <Text style={styles.postBtnLabel}>{t("composer.post")}</Text>
        </PressableScale>
      </View>

      {/* Rules gate: swallow every touch until the UGC rules are accepted. */}
      {locked && (
        <Pressable style={StyleSheet.absoluteFill} onPress={openRulesGate}>
          <View />
        </Pressable>
      )}

      <RulesSheet
        visible={rulesVisible}
        onAccepted={() => {
          setRulesVisible(false);
          // Land straight in the now-unlocked field once the sheet has
          // dismissed (Eve source: same 320ms handoff).
          setTimeout(() => inputRef.current?.focus(), 320);
        }}
        onClose={() => setRulesVisible(false)}
      />

      <CommunitySheet
        visible={topicPickerOpen}
        onClose={() => setTopicPickerOpen(false)}
        onDismissed={() => inputRef.current?.focus()}
      >
        <SheetScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.pickerTitle}>{t("composer.chooseTopic")}</Text>
          {topics.map((option) => {
            const on = topic === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => {
                  if (!on) haptic("selection");
                  setTopic(option.id);
                  setTopicPickerOpen(false);
                }}
                style={({ pressed }) => [styles.pickerRow, (on || pressed) && styles.pickerRowOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.pickerLabel, on && styles.pickerLabelOn]}>
                  {t(`topics.${option.id}`)}
                </Text>
                {on && <icons.checkmark size={18} color={theme.colors.accent} weight="fill" />}
              </Pressable>
            );
          })}
        </SheetScrollView>
      </CommunitySheet>
    </View>
  );
});

const makeStyles = (theme: CommunityTheme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      marginTop: theme.spacing(4),
      marginBottom: theme.spacing(4.5),
    },
    // Concentric with the card: radius.lg − spacing(4) padding = radius.sm.
    inputBox: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    input: {
      padding: theme.spacing(3.5),
      minHeight: 84,
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 15,
      lineHeight: 22,
      color: theme.colors.textPrimary,
      textAlignVertical: "top",
    },
    placeholder: { position: "absolute", left: 0, right: 0, color: theme.colors.textFaint },
    // Taller while composing, with room for the topic select underneath.
    inputComposing: { minHeight: 132, paddingBottom: theme.spacing(12) },
    topicSelect: {
      position: "absolute",
      right: theme.spacing(2),
      bottom: theme.spacing(2),
      maxWidth: "70%",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
      height: 32,
      paddingHorizontal: theme.spacing(3),
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    topicSelectText: {
      flexShrink: 1,
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13,
      color: theme.colors.textPrimary,
    },
    chevron: { transform: [{ rotate: "-90deg" }] },
    pickerTitle: {
      fontFamily: theme.fonts.serifBold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 20,
      color: theme.colors.textPrimary,
      marginBottom: theme.spacing(3),
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 48,
      paddingHorizontal: theme.spacing(4),
      borderRadius: theme.radius.md,
      marginBottom: theme.spacing(1),
    },
    pickerRowOn: { backgroundColor: theme.colors.surfaceMuted },
    pickerLabel: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 15,
      color: theme.colors.textSecondary,
    },
    pickerLabelOn: { color: theme.colors.textPrimary },
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
    footer: { flexDirection: "row", alignItems: "center", marginTop: theme.spacing(3) },
    pollToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1.75),
      paddingVertical: theme.spacing(1.5),
    },
    pollToggleText: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13.5,
      color: theme.colors.accent,
    },
    // Concentric with the card corner it sits in (radius.lg − spacing(4)).
    postBtn: {
      marginLeft: "auto",
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      height: 44,
      justifyContent: "center",
      paddingHorizontal: theme.spacing(6),
    },
    // Dimmed rather than recolored: stays visible on any card color.
    postBtnDisabled: { opacity: 0.35 },
    postBtnLabel: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 13.5,
      letterSpacing: 1.2,
      color: theme.colors.textInverse,
    },
  });
