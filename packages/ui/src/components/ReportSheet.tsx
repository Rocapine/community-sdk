// Report a post or comment. Ported from the mold's `ReportSheet`
// (`sdk/client/components/community/ReportSheet.tsx`), rebuilt on this
// package's `CommunitySheet`/theme/i18n.
//
// Signature change from both sources (task brief): `target` is
// `{ kind: "post" | "comment"; id: string } | null` instead of the mold's
// `{ reportedUserId, postId?, commentId? }` — this sheet no longer needs the
// author id up front. `useReport`'s `ReportInput.reportedUserId` was widened
// to optional in `@rocapine/community-core` (packages/core/src/service.ts,
// this task) precisely for this: `reportContent` resolves the author itself
// from `postId`/`commentId` when it is omitted, so a caller that only knows
// "which post/comment" (exactly what `target` carries) can still report it
// without a separate lookup round trip of its own.
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

export function ReportSheet({
  visible,
  target,
  onClose,
}: {
  visible: boolean;
  target: { kind: "post" | "comment"; id: string } | null;
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
