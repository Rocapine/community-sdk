// The "new message" member picker (`dms.entryPoints` has `"newMessage"`), opened from the
// pencil of the Messages page's Conversations: a search field and the members I may
// start a DM with (`useMemberSearch`: not me, not banned, no block either way, and an
// existing DM or one they accept). Tapping one closes the sheet; `onPick` runs once it
// is gone, so the conversation the host pushes isn't left under the sheet's Modal.
import { useMemberSearch, type CommunityProfile } from "@rocapine/community-core";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { CommunitySheet, SheetScrollView, SheetTextInput } from "../Sheet";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { noFocusRing } from "../utils/noFocusRing";
import { Avatar } from "./Avatar";

const SEARCH_DELAY_MS = 250;

export function NewMessageSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose(): void;
  onPick(memberId: string): void;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  // One search per pause in typing, not per key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(term), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [term]);
  const { members, isLoading } = useMemberSearch(query);
  const picked = useRef<string | null>(null);

  const pick = (m: CommunityProfile) => {
    picked.current = m.id;
    onClose();
  };

  return (
    <CommunitySheet
      visible={visible}
      onClose={onClose}
      snapTo="full"
      onDismissed={() => {
        setTerm("");
        setQuery("");
        const id = picked.current;
        picked.current = null;
        if (id) onPick(id);
      }}
    >
      <SheetScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">
          {t("dms.new.title")}
        </Text>
        <View style={styles.searchField}>
          <icons.search size={16} color={theme.colors.textFaint} />
          <SheetTextInput
            value={term}
            onChangeText={setTerm}
            placeholder={t("dms.new.search")}
            placeholderTextColor={theme.colors.textFaint}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={t("dms.new.search")}
            style={styles.searchInput}
          />
        </View>
        {isLoading ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
        ) : query.trim() && members.length === 0 ? (
          <Text style={styles.empty}>{t("dms.new.empty")}</Text>
        ) : (
          members.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => pick(m)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={m.name}
            >
              <Avatar
                userId={m.id}
                name={m.name}
                url={m.avatarUrl}
                size={40}
                placement="member"
                admin={m.admin}
                handle={m.handle}
                badges={m.badges}
              />
              <Text style={styles.name} numberOfLines={1}>
                {m.name}
              </Text>
            </Pressable>
          ))
        )}
      </SheetScrollView>
    </CommunitySheet>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    title: {
      ...theme.typography.heading,
      color: theme.colors.textPrimary,
      marginBottom: theme.spacing(4),
    },
    searchField: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      marginBottom: theme.spacing(2),
      paddingHorizontal: theme.spacing(3),
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.md,
    },
    searchInput: {
      flex: 1,
      ...theme.typography.input,
      color: theme.colors.textPrimary,
      paddingVertical: theme.spacing(2.5),
      ...noFocusRing,
    },
    loader: { marginTop: theme.spacing(6) },
    empty: {
      ...theme.typography.meta,
      color: theme.colors.textMuted,
      textAlign: "center",
      marginTop: theme.spacing(6),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingVertical: theme.spacing(2.5),
    },
    pressed: { opacity: 0.6 },
    name: {
      ...theme.typography.body,
      flex: 1,
      color: theme.colors.textPrimary,
    },
  });
}
