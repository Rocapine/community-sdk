// A message's menu: a sheet of actions (Like, Reply, Copy, Translate, Edit, Delete,
// Report…, built by the screen). An action with `confirm` asks first, inside the same
// sheet: no system alert, which react-native-web doesn't show.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CommunitySheet, SheetView } from "../../Sheet";
import { useCommunityTheme, useT, useThemedStyles } from "../../ThemeProvider";
import type { CommunityTheme } from "../../theme";

export type MessageMenuAction = {
  key: string;
  label: string;
  destructive?: boolean;
  /** A question asked before running it (e.g. "Delete this message?"). */
  confirm?: string;
  onPress(): void;
};

export function MessageMenu({
  visible,
  actions,
  onClose,
  onDismissed,
  title,
}: {
  visible: boolean;
  actions: MessageMenuAction[];
  /** A question above the actions, with a Cancel row under them (a confirmation). */
  title?: string;
  onClose(): void;
  /** The sheet is fully gone: open the next sheet from here (iOS). */
  onDismissed?(): void;
}) {
  const t = useT();
  const theme = useCommunityTheme();
  const styles = useThemedStyles(makeStyles);
  const [confirming, setConfirming] = useState<MessageMenuAction | null>(null);
  useEffect(() => {
    if (visible) setConfirming(null);
  }, [visible]);

  const run = (a: MessageMenuAction) => {
    if (a.confirm && !confirming) return setConfirming(a);
    onClose();
    a.onPress();
  };

  const row = (a: MessageMenuAction) => (
    <Pressable
      key={a.key}
      onPress={() => run(a)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <Text style={[styles.label, a.destructive && { color: theme.colors.danger }]}>{a.label}</Text>
    </Pressable>
  );

  return (
    <CommunitySheet visible={visible} onClose={onClose} onDismissed={onDismissed}>
      <SheetView>
        {confirming ? (
          <View>
            <Text style={styles.question}>{confirming.confirm}</Text>
            {row(confirming)}
            <Pressable
              onPress={() => setConfirming(null)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.label}>{t("menu.cancel")}</Text>
            </Pressable>
          </View>
        ) : title ? (
          <View>
            <Text style={styles.question}>{title}</Text>
            {actions.map((a) => row(a))}
            {row({ key: "cancel", label: t("menu.cancel"), onPress: () => {} })}
          </View>
        ) : (
          actions.map((a) => row(a))
        )}
      </SheetView>
    </CommunitySheet>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    row: {
      paddingVertical: theme.spacing(3.5),
      paddingHorizontal: theme.spacing(1),
      borderRadius: theme.radius.sm,
    },
    pressed: { backgroundColor: theme.colors.hairline },
    label: { ...theme.typography.label, color: theme.colors.textPrimary },
    question: {
      ...theme.typography.heading,
      color: theme.colors.textPrimary,
      marginBottom: theme.spacing(2),
    },
  });
}
