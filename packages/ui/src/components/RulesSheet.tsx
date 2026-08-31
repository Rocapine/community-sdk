// Community guidelines gate. Ported from the mold's `CommunityRulesSheet`
// (`sdk/client/components/community/CommunityRulesSheet.tsx`), rebuilt on
// this package's own `CommunitySheet` (Task 10) and theme/i18n (no
// Eve-specific `eve.cream`/`eve.ink` literals, no local haptics wrapper —
// raw `expo-haptics`, matching `CommunityPost`/`NoticeCard`'s convention).
//
// No store: acceptance state is owned entirely by the host through
// `cfg.host.rulesAcceptance` (Task 2's config seam). This sheet only calls
// `.set()` on accept, emits `COMMUNITY_EVENTS.rulesAccepted`, and reports
// back through `onAccepted` — the caller (typically `ComposerCard`, which
// also reads `.get()` to decide whether to show this sheet at all) owns any
// local "am I unlocked" state.
//
// The brief describes "4 rules from i18n keys rules.1..4" generically; the
// catalog (Task 9, ported from Eve's actual copy) names them semantically
// instead of numbering them — `rules.kind` / `rules.medical` / `rules.hateful`
// / `rules.report` — so those are the 4 keys read below.

import { COMMUNITY_EVENTS, emitEvent, useCommunityConfig } from "@rocapine/community-core";
import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CommunitySheet } from "../Sheet";
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";

const RULE_KEYS = ["rules.kind", "rules.medical", "rules.hateful", "rules.report"] as const;

export function RulesSheet({
  visible,
  onAccepted,
  onClose,
}: {
  visible: boolean;
  onAccepted: () => void;
  onClose: () => void;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);

  const handleAccept = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await cfg.host.rulesAcceptance.set();
    } catch {
      // A broken host adapter must never trap someone behind this gate.
    }
    emitEvent(cfg, COMMUNITY_EVENTS.rulesAccepted);
    onAccepted();
  };

  return (
    <CommunitySheet visible={visible} onClose={onClose} snapTo="half">
      <Text style={styles.title}>{t("rules.title")}</Text>
      <View style={styles.rules}>
        {RULE_KEYS.map((key) => (
          <Text key={key} style={styles.rule}>
            {"•"} {t(key)}
          </Text>
        ))}
      </View>
      <Pressable
        onPress={handleAccept}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
      >
        <Text style={styles.ctaLabel}>{t("rules.accept")}</Text>
      </Pressable>
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
    rules: { gap: theme.spacing(3) },
    rule: {
      fontFamily: theme.fonts.regular,
      fontSize: 14.5,
      lineHeight: 21,
      color: theme.colors.textSecondary,
    },
    cta: {
      backgroundColor: theme.colors.textPrimary,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(4),
      alignItems: "center",
      marginTop: theme.spacing(6),
    },
    ctaPressed: { opacity: 0.9 },
    ctaLabel: { fontFamily: theme.fonts.bold, fontSize: 15, color: theme.colors.textInverse },
  });
}
