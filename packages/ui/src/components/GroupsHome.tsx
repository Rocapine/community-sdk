// The "Groups" side of the community home (`messaging.homeLayout: "segmented"`,
// validated mockup A), in this order: a search field that opens Explore, "My groups"
// with their unread counts (grey when muted), "To discover" with a few active groups I
// haven't joined and "See all", and "Create a group". Joining and creating follow
// Explore's rules (the SDK's account checks, then the host gates).
import {
  groupsSettings,
  useAccountLinked,
  useCommunityConfig,
  useConversations,
  useGroupOnlineCounts,
  useGroupSearch,
} from "@rocapine/community-core";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { GroupConversationRow } from "../screens/MessagesScreen";
import { exploreRowTap, needsAccount } from "../utils/groups";
import { isQueryLoading } from "../utils/query";
import { useNow } from "../utils/time";
import { GroupFormSheet } from "./GroupFormSheet";
import { GroupRow } from "./GroupRow";
import { useGuardedJoin } from "./GroupAttachment";

/** Active groups shown under "To discover". */
const DISCOVER_COUNT = 5;

export function GroupsHome({
  topInset,
  bottomInset,
  onOpenGroup,
  onOpenExplore,
  beforeJoinGroup,
  beforeCreate,
}: {
  /** The feed's top bar, which floats over this list. */
  topInset: number;
  /** A host bar over the bottom (`bottomChrome`). */
  bottomInset: number;
  onOpenGroup(groupId: string, preview: boolean): void;
  onOpenExplore(): void;
  beforeJoinGroup?: () => Promise<boolean>;
  beforeCreate?: () => Promise<boolean>;
}) {
  const cfg = useCommunityConfig();
  const settings = groupsSettings(cfg)!;
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const now = useNow();
  const linked = useAccountLinked();

  const conversations = useConversations();
  const mine = useMemo(
    () =>
      (conversations.data ?? [])
        .filter((c) => c.kind === "group")
        .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")),
    [conversations.data],
  );
  const search = useGroupSearch("");
  const discover = useMemo(
    () => (search.data?.pages.flat() ?? []).filter((g) => !g.isMember).slice(0, DISCOVER_COUNT),
    [search.data],
  );
  const online = useGroupOnlineCounts(useMemo(() => discover.map((g) => g.id), [discover]));
  const { joiningId, error, join } = useGuardedJoin("explore", beforeJoinGroup);
  const [creating, setCreating] = useState(false);
  const [gating, setGating] = useState(false);

  const startCreate = async () => {
    if (gating) return;
    if (needsAccount(settings.createRequiresAccount, linked))
      return cfg.host.onAccountRequired?.("createGroup");
    setGating(true);
    // A gate that throws counts as "no".
    const allowed = beforeCreate ? await beforeCreate().catch(() => false) : true;
    setGating(false);
    if (allowed) setCreating(true);
  };

  return (
    <>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: topInset + theme.spacing(3),
          paddingBottom: bottomInset + theme.spacing(8),
        }}
      >
        <Pressable
          onPress={onOpenExplore}
          style={({ pressed }) => [styles.search, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t("groups.explore.search")}
        >
          <icons.search size={16} color={theme.colors.textFaint} />
          <Text style={styles.searchText} numberOfLines={1}>
            {t("groups.explore.search")}
          </Text>
        </Pressable>
        {error && (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        )}

        <Text style={styles.section} accessibilityRole="header">
          {t("groups.home.mine")}
        </Text>
        {isQueryLoading(conversations) ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
        ) : conversations.isError && !conversations.data ? (
          <Text style={styles.empty}>{t("feed.unreachableRetry")}</Text>
        ) : mine.length === 0 ? (
          <Text style={styles.empty}>{t("messages.empty")}</Text>
        ) : (
          mine.map((c) => (
            <GroupConversationRow
              key={c.id}
              conversation={c}
              now={now}
              onPress={(id) => onOpenGroup(id, false)}
            />
          ))
        )}

        {discover.length > 0 && (
          <>
            <View style={styles.sectionRow}>
              <Text style={[styles.section, styles.flex]} accessibilityRole="header">
                {t("groups.home.discover")}
              </Text>
              <Pressable
                onPress={onOpenExplore}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`${t("groups.home.seeAll")}, ${t("groups.home.discover")}`}
              >
                <Text style={styles.seeAll}>{t("groups.home.seeAll")} ›</Text>
              </Pressable>
            </View>
            {discover.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                online={online[g.id] ?? 0}
                layout="list"
                busy={joiningId === g.id}
                onPress={() => {
                  const to = exploreRowTap(g, settings.preview);
                  if (to === "join") void join(g.id, () => onOpenGroup(g.id, false));
                  else onOpenGroup(g.id, to === "preview");
                }}
                onAction={(action) =>
                  action === "open"
                    ? onOpenGroup(g.id, false)
                    : void join(g.id, () => onOpenGroup(g.id, false))
                }
              />
            ))}
          </>
        )}

        <Pressable
          onPress={() => void startCreate()}
          disabled={gating}
          hitSlop={4}
          style={({ pressed }) => [styles.create, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <icons.add size={16} color={theme.colors.accent} weight="bold" />
          <Text style={styles.createLabel}>{t("groups.explore.create")}</Text>
        </Pressable>
      </ScrollView>

      <GroupFormSheet
        visible={creating}
        mode="create"
        onClose={() => setCreating(false)}
        onDone={(id) => {
          setCreating(false);
          onOpenGroup(id, false);
        }}
      />
    </>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    pressed: { opacity: 0.7 },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      marginHorizontal: theme.spacing(4),
      marginBottom: theme.spacing(2),
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2.5),
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.md,
    },
    searchText: { flex: 1, ...theme.typography.input, color: theme.colors.textFaint },
    error: {
      ...theme.typography.caption,
      color: theme.colors.danger,
      textAlign: "center",
      marginHorizontal: theme.spacing(4),
      marginBottom: theme.spacing(2),
    },
    sectionRow: {
      flexDirection: "row",
      alignItems: "center",
      marginRight: theme.spacing(4),
    },
    section: {
      ...theme.typography.caption,
      color: theme.colors.textFaint,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginHorizontal: theme.spacing(4),
      marginTop: theme.spacing(4),
      marginBottom: theme.spacing(1),
    },
    seeAll: {
      ...theme.typography.meta,
      color: theme.colors.accent,
      marginTop: theme.spacing(4),
      marginBottom: theme.spacing(1),
    },
    loader: { marginVertical: theme.spacing(4) },
    empty: {
      ...theme.typography.bodySmall,
      color: theme.colors.textFaint,
      marginHorizontal: theme.spacing(4),
      marginVertical: theme.spacing(3),
    },
    create: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "center",
      gap: theme.spacing(1.5),
      marginTop: theme.spacing(5),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2.5),
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
    },
    createLabel: { ...theme.typography.label, color: theme.colors.accent },
  });
}
