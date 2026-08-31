// Report a post or comment. Ported from the mold's `ReportSheet`
// (`sdk/client/components/community/ReportSheet.tsx`), rebuilt on this
// package's `CommunitySheet`/theme/i18n.
//
// Signature change from the mold (task brief, refined in review — see
// task-11-report.md's fix-up section): `target` is
// `{ kind: "post" | "comment"; id: string; authorId: string } | null`
// instead of the mold's flat `{ reportedUserId, postId?, commentId? }`.
// `authorId` is required on the target (not resolved by a lookup): the
// screen that renders the "Report" menu item always already holds the full
// post/comment object (mold/Eve pattern — `onMenu(post)` on `CommunityPost`,
// Task 10), so it can pass `post.authorId`/`comment.authorId` straight
// through. An earlier version of this file had `reportContent` resolve the
// author itself via a `select author_id` on `posts`/`comments`, but that
// lookup is RLS-gated the same as the feed (`status = 'visible'`, author not
// blocked) — reporting moderation-hidden content or a just-blocked author
// would throw PGRST116 there, surfacing as a misleading network error
// instead of ever reaching the actual report insert. Requiring `authorId` up
// front avoids that lookup entirely.
//
// `visible` and `target` are kept as two separate props per the brief
// (rather than deriving visibility from `target !== null` like the mold) so
// a host can hold `target` steady while `visible` animates closed.

import { useReport, type ReportReason } from "@rocapine/community-core";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CommunitySheet } from "../Sheet";
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";

const REASONS: ReportReason[] = ["spam", "harassment", "hate", "inappropriate", "other"];

/** Exported so callers building a report target (`CommunityFeedScreen`,
 * `ThreadSheet`, …) share one type instead of each redeclaring an identical
 * inline shape. */
export type ReportTarget = { kind: "post" | "comment"; id: string; authorId: string };

export function ReportSheet({
  visible,
  target,
  onClose,
}: {
  visible: boolean;
  target: ReportTarget | null;
  onClose: () => void;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const report = useReport();

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");

  // A new target (report a different post/comment) starts from a clean form,
  // even if the host reuses the same sheet instance without a close in between.
  useEffect(() => {
    setReason(null);
    setDetails("");
  }, [target?.kind, target?.id]);

  const close = () => {
    setReason(null);
    setDetails("");
    onClose();
  };

  const submit = () => {
    if (!target || !reason || report.isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    report.mutate(
      {
        reportedUserId: target.authorId,
        postId: target.kind === "post" ? target.id : undefined,
        commentId: target.kind === "comment" ? target.id : undefined,
        reason,
        details,
      },
      {
        onSuccess: () => {
          close();
          Alert.alert(t("report.sentTitle"), t("report.sentBody"));
        },
        onError: () => Alert.alert(t("report.errorTitle"), t("report.errorBody")),
      },
    );
  };

  return (
    <CommunitySheet visible={visible} onClose={close} snapTo="half">
      {/* keyboardShouldPersistTaps="always" so the reason chips and Send fire
          on the first tap while the keyboard is open (mold behavior, ported
          as-is — see that file's own note on why "handled" is not enough
          inside a Modal + reanimated sheet). */}
      <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t("report.title")}</Text>
        <View style={styles.reasonRow}>
          {REASONS.map((r) => {
            const on = reason === r;
            return (
              <Pressable
                key={r}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setReason(r);
                }}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {t(`report.reasons.${r}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          value={details}
          onChangeText={setDetails}
          placeholder={t("report.detailsPlaceholder")}
          placeholderTextColor={theme.colors.textFaint}
          multiline
          style={styles.input}
        />
        <Pressable
          onPress={submit}
          disabled={!reason || report.isPending}
          style={({ pressed }) => [
            styles.cta,
            (!reason || report.isPending) && styles.ctaDisabled,
            pressed && styles.ctaPressed,
          ]}
        >
          <Text style={styles.ctaLabel}>{t("report.send")}</Text>
        </Pressable>
      </ScrollView>
    </CommunitySheet>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    title: {
      fontFamily: theme.fonts.serifBold,
      fontSize: 22,
      color: theme.colors.textPrimary,
      marginBottom: theme.spacing(4),
    },
    reasonRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing(2),
      marginBottom: theme.spacing(4),
    },
    chip: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2.25),
      paddingHorizontal: theme.spacing(3.5),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    chipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    chipText: { fontFamily: theme.fonts.medium, fontSize: 13, color: theme.colors.textSecondary },
    chipTextOn: { color: theme.colors.textInverse },
    input: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      minHeight: 80,
      fontFamily: theme.fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: theme.colors.textPrimary,
      textAlignVertical: "top",
    },
    cta: {
      backgroundColor: theme.colors.textPrimary,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(4),
      alignItems: "center",
      marginTop: theme.spacing(4),
    },
    ctaDisabled: { opacity: 0.5 },
    ctaPressed: { opacity: 0.9 },
    ctaLabel: { fontFamily: theme.fonts.bold, fontSize: 15, color: theme.colors.textInverse },
  });
}
