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
//  - No `ComposerCardHandle`/`forwardRef` — the brief's signature is a plain
//    function component.
//  - Topic chips are config-driven (`cfg.composeTopics()`, labeled
//    `t("topics."+id)`) instead of the app's static `COMPOSE_TOPICS` list.
//  - The poll toggle + editor only render when `cfg.modules.polls` is on.
//  - New `renderComposerExtra` slot (a plain `ReactNode`, not a render-prop)
//    for a host to add its own footer affordance (e.g. an attach button)
//    without forking this file — rendered between the poll toggle and the
//    POST pill.
//
// The topic chips only appear while composing (focus, text or an open poll)
// so they don't duplicate a feed's own filter chips sitting above this card
// (same reasoning as the Eve source).

import {
  displayName,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POST_MAX_LENGTH,
  useCommunityConfig,
  useCreatePost,
} from "@rocapine/community-core";
import * as Haptics from "expo-haptics";
import { ChartBarHorizontal, Plus, X } from "phosphor-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { RulesSheet } from "./RulesSheet";

export function ComposerCard({
  defaultTopic,
  renderComposerExtra,
}: {
  defaultTopic?: string;
  renderComposerExtra?: ReactNode;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);
  const createPost = useCreatePost();

  const topics = cfg.composeTopics();
  const [topic, setTopic] = useState<string>(defaultTopic ?? topics[0]?.id ?? "general");
  const [text, setText] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  // null = no poll on this draft; an array = the poll editor is open.
  const [pollDraft, setPollDraft] = useState<string[] | null>(null);

  // Rules gate: loaded once from the host adapter, no store. Defaults to
  // locked until the adapter answers, so posting is never possible for a
  // frame before we actually know the acceptance state.
  const [accepted, setAccepted] = useState(false);
  const [rulesVisible, setRulesVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    cfg.host.rulesAcceptance.get().then((ok) => {
      if (alive) setAccepted(ok);
    });
    return () => {
      alive = false;
    };
  }, [cfg]);

  const locked = !accepted;
  const openRulesGate = () => setRulesVisible(true);

  // The feed's filter chips sit right above this card in a typical layout, so
  // an always-visible topic row would read as a duplicate. Reveal it only
  // while composing.
  const composing = inputFocused || text.trim().length > 0 || pollDraft !== null;

  const filledPollOptions = (pollDraft ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
  const pollInvalid = pollDraft !== null && filledPollOptions.length < POLL_MIN_OPTIONS;
  const pending = createPost.isPending;
  const canPost = text.trim().length > 0 && !pollInvalid && !pending;

  const togglePoll = () => {
    Haptics.selectionAsync().catch(() => {});
    setPollDraft((prev) => (prev === null ? ["", ""] : null));
  };

  const submit = () => {
    if (!canPost) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const authorName = displayName(cfg.host.getDisplayName(), cfg.anonymousAuthorFallback);
    createPost.mutate({
      topic,
      text: text.trim(),
      authorName,
      pollOptions: pollDraft !== null ? filledPollOptions : undefined,
    });
    setText("");
    setPollDraft(null);
    Keyboard.dismiss();
  };

  return (
    <View style={styles.card}>
      {/* Single scrollable line, bleeding to the card edge like a feed's own filter row. */}
      {composing && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.topicScroll}
          contentContainerStyle={styles.topicRow}
          keyboardShouldPersistTaps="always"
        >
          {topics.map((option) => {
            const on = topic === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setTopic(option.id);
                }}
                style={[styles.topicChip, on && styles.topicChipOn]}
              >
                <Text style={[styles.topicChipText, on && styles.topicChipTextOn]}>
                  {t(`topics.${option.id}`)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <TextInput
        value={text}
        onChangeText={setText}
        onFocus={() => setInputFocused(true)}
        onBlur={() => setInputFocused(false)}
        placeholder={pollDraft !== null ? t("composer.pollPlaceholder") : t("composer.placeholder")}
        placeholderTextColor={theme.colors.textFaint}
        multiline
        maxLength={POST_MAX_LENGTH}
        style={styles.input}
      />

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
                >
                  <X size={16} color={theme.colors.textFaint} weight="bold" />
                </Pressable>
              )}
            </View>
          ))}
          {pollDraft.length < POLL_MAX_OPTIONS && (
            <Pressable
              onPress={() => setPollDraft((prev) => (prev ? [...prev, ""] : prev))}
              style={styles.pollAdd}
            >
              <Plus size={14} color={theme.colors.accent} weight="bold" />
              <Text style={styles.pollAddText}>{t("composer.addOption")}</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.footer}>
        {cfg.modules.polls && (
          <Pressable onPress={togglePoll} hitSlop={6} style={styles.pollToggle}>
            <ChartBarHorizontal size={18} color={theme.colors.accent} weight="regular" />
            <Text style={styles.pollToggleText}>
              {pollDraft !== null ? t("composer.removePoll") : t("composer.poll")}
            </Text>
          </Pressable>
        )}
        {renderComposerExtra}
        <Pressable
          onPress={submit}
          disabled={!canPost}
          style={({ pressed }) => [
            styles.postBtn,
            !canPost && styles.postBtnDisabled,
            pressed && canPost && styles.postBtnPressed,
          ]}
        >
          <Text style={[styles.postBtnLabel, !canPost && styles.postBtnLabelDisabled]}>
            {t("composer.post")}
          </Text>
        </Pressable>
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
          setAccepted(true);
          setRulesVisible(false);
        }}
        onClose={() => setRulesVisible(false)}
      />
    </View>
  );
}

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
    topicScroll: { marginHorizontal: -theme.spacing(4), marginBottom: theme.spacing(3) },
    topicRow: { flexDirection: "row", gap: theme.spacing(2), paddingHorizontal: theme.spacing(4) },
    topicChip: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2.25),
      paddingHorizontal: theme.spacing(3.75),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    topicChipOn: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
    topicChipText: { fontFamily: theme.fonts.medium, fontSize: 13, color: theme.colors.textMuted },
    topicChipTextOn: { color: theme.colors.accent },
    input: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(3.5),
      minHeight: 84,
      fontFamily: theme.fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: theme.colors.textPrimary,
      textAlignVertical: "top",
    },
    pollEditor: { marginTop: theme.spacing(3), gap: theme.spacing(2) },
    pollOptionRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2.5) },
    pollOptionInput: {
      flex: 1,
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.sm + 4,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing(3.5),
      paddingVertical: theme.spacing(2.75),
      fontFamily: theme.fonts.regular,
      fontSize: 14,
      color: theme.colors.textPrimary,
    },
    pollAdd: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1.5),
      paddingVertical: theme.spacing(1.5),
    },
    pollAddText: { fontFamily: theme.fonts.medium, fontSize: 13, color: theme.colors.accent },
    footer: { flexDirection: "row", alignItems: "center", marginTop: theme.spacing(3) },
    pollToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1.75),
      paddingVertical: theme.spacing(1.5),
    },
    pollToggleText: { fontFamily: theme.fonts.medium, fontSize: 13.5, color: theme.colors.accent },
    postBtn: {
      marginLeft: "auto",
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(3),
      paddingHorizontal: theme.spacing(7),
    },
    postBtnPressed: { opacity: 0.9 },
    postBtnDisabled: { backgroundColor: theme.colors.surfaceMuted },
    postBtnLabel: {
      fontFamily: theme.fonts.bold,
      fontSize: 13.5,
      letterSpacing: 1.2,
      color: theme.colors.textInverse,
    },
    postBtnLabelDisabled: { color: theme.colors.textFaint },
  });
