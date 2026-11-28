// A message's menu: a sheet of actions (Like, Reply, Copy, Translate, Edit, Delete,
// Report…, built by the screen). An action with `confirm` asks first, inside the same
// sheet: no system alert, which react-native-web doesn't show.
// `useActionMenu`: the post and comment "…" menus, on this sheet on Android.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View, type AlertButton } from "react-native";
import { CommunitySheet, SheetView } from "../../Sheet";
import { useCommunityTheme, useT, useThemedStyles } from "../../ThemeProvider";
import type { CommunityTheme } from "../../theme";
import { menuActions } from "../../utils/menu";

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

/** `show(title, buttons)` opens a post or comment "…" menu: the system alert on iOS and
 * web, as before; this sheet on Android, whose alert shows three buttons at most (the
 * fourth and Cancel are dropped) and can't be dismissed. Render `sheet` in the screen. */
export function useActionMenu(): {
  show(title: string, buttons: AlertButton[]): void;
  sheet: ReactElement | null;
} {
  const [menu, setMenu] = useState({ open: false, title: "", actions: [] as MessageMenuAction[] });
  const show = useCallback((title: string, buttons: AlertButton[]) => {
    if (Platform.OS === "android") setMenu({ open: true, title, actions: menuActions(buttons) });
    else Alert.alert(title, undefined, buttons);
  }, []);
  const sheet =
    Platform.OS === "android" ? (
      <MessageMenu
        visible={menu.open}
        title={menu.title}
        actions={menu.actions}
        onClose={() => setMenu((m) => ({ ...m, open: false }))}
      />
    ) : null;
  return { show, sheet };
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
