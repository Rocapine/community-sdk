// Explore groups (validated mockup A: compact list; B: cards with a banner,
// `exploreLayout: "cards"`): a search field (debounced), the visible groups latest
// activity first, each with "N members · X online" (online only above 0) and Join or
// Open, and a `+` that creates a group. Tapping a row opens it, as a read-only preview
// when I'm not a member (`groups.preview: "none"`: it joins instead); Join joins right
// away and opens it.
//
// The SDK's own checks run first, the backend enforces them anyway: creating needs a
// linked account when `createRequiresAccount`, joining when `requireAccount: true`.
// Then the host gates: `beforeCreate`, and `beforeJoinGroup` (with `requireAccount:
// "feed"`, pass the feed's `beforeCompose`). Renders nothing when groups is off.
import {
  COMMUNITY_EVENTS,
  emitEvent,
  groupsSettings,
  useAccountLinked,
  useCommunityConfig,
  useGroupOnlineCounts,
  useGroupSearch,
  type Group,
} from "@rocapine/community-core";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { GroupFormSheet } from "../components/GroupFormSheet";
import { GroupRow } from "../components/GroupRow";
import { ScreenBackground } from "../components/ScreenBackground";
import { useGuardedJoin } from "../components/GroupAttachment";
import { exploreRowTap, needsAccount } from "../utils/groups";
import { noFocusRing } from "../utils/noFocusRing";
import { isQueryLoading } from "../utils/query";

const SEARCH_DEBOUNCE_MS = 300;

export type ExploreGroupsScreenProps = {
  /** `preview`: I'm not a member, open it read-only with a "Join" bar. */
  onOpenGroup(id: string, preview: boolean): void;
  onBack(): void;
  /** Host gate before creating a group (same contract as the feed's `beforeCompose`):
   * resolve false to cancel. */
  beforeCreate?: () => Promise<boolean>;
  /** Host gate before joining, after the SDK's own checks (same contract as
   * `beforeCompose`; with `requireAccount: "feed"`, pass the feed's `beforeCompose`). */
  beforeJoinGroup?: () => Promise<boolean>;
};

export function ExploreGroupsScreen(props: ExploreGroupsScreenProps) {
  const cfg = useCommunityConfig();
  if (!groupsSettings(cfg)) return null;
  return <Explore {...props} />;
}

/** Runs a host gate; a throw counts as "no". */
async function passes(gate?: () => Promise<boolean>): Promise<boolean> {
  if (!gate) return true;
  try {
    return await gate();
  } catch {
    return false;
  }
}

function Explore({ onOpenGroup, onBack, beforeCreate, beforeJoinGroup }: ExploreGroupsScreenProps) {
  const cfg = useCommunityConfig();
  const settings = groupsSettings(cfg)!;
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const accountLinked = useAccountLinked();

  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);
  const search = useGroupSearch(query);
  const groups = useMemo(() => search.data?.pages.flat() ?? [], [search.data]);
  const online = useGroupOnlineCounts(useMemo(() => groups.map((g) => g.id), [groups]));

  const { joiningId, error, join } = useGuardedJoin("explore", beforeJoinGroup);
  const [creating, setCreating] = useState(false);
  const [gating, setGating] = useState(false);

  useEffect(() => {
    emitEvent(cfg, COMMUNITY_EVENTS.groupExploreOpened);
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gated = async (gate?: () => Promise<boolean>) => {
    setGating(true);
    try {
      return await passes(gate);
    } finally {
      setGating(false);
    }
  };

  const joinGroup = (g: Group) => {
    if (gating) return;
    void join(g.id, () => onOpenGroup(g.id, false));
  };

  const tap = (g: Group) => {
    const action = exploreRowTap(g, settings.preview);
    if (action === "join") joinGroup(g);
    else onOpenGroup(g.id, action === "preview");
  };

  const startCreate = async () => {
    if (gating) return;
    if (needsAccount(settings.createRequiresAccount, accountLinked))
      return cfg.host.onAccountRequired?.("createGroup");
    if (await gated(beforeCreate)) setCreating(true);
  };

  const searchBar = (
    <>
      <View style={styles.searchField}>
        <icons.search size={16} color={theme.colors.textFaint} />
        <TextInput
          value={term}
          onChangeText={setTerm}
          onSubmitEditing={() => {
            setQuery(term);
            if (term.trim()) emitEvent(cfg, COMMUNITY_EVENTS.groupSearched);
          }}
          returnKeyType="search"
          placeholder={t("groups.explore.search")}
          placeholderTextColor={theme.colors.textFaint}
          autoCorrect={false}
          accessibilityLabel={t("groups.explore.search")}
          style={styles.searchInput}
        />
        {term.length > 0 && (
          <Pressable
            onPress={() => setTerm("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("a11y.clearSearch")}
          >
            <icons.close size={14} color={theme.colors.textFaint} />
          </Pressable>
        )}
      </View>
      {/* Outside the list, so a join error shows whatever the scroll position. */}
      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </>
  );
  const header =
    !query.trim() && groups.length > 0 ? (
      <Text style={styles.section}>{t("groups.explore.recent")}</Text>
    ) : null;

  return (
    <View style={styles.root}>
      <ScreenBackground />
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.back")}
        >
          <icons.back size={22} color={theme.colors.textPrimary} weight="bold" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {t("groups.explore.title")}
        </Text>
        <Pressable
          onPress={() => void startCreate()}
          disabled={gating}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t("groups.explore.create")}
        >
          <View style={styles.plus}>
            <icons.add size={18} color={theme.colors.textInverse} weight="bold" />
          </View>
        </Pressable>
      </View>

      {searchBar}
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <GroupRow
            group={item}
            online={online[item.id] ?? 0}
            layout={settings.exploreLayout}
            busy={joiningId === item.id}
            onPress={() => tap(item)}
            onAction={(action) =>
              action === "open" ? onOpenGroup(item.id, false) : joinGroup(item)
            }
          />
        )}
        onEndReached={() => {
          if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          isQueryLoading(search) ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
          ) : (
            <Text style={styles.empty}>
              {t(search.isError ? "feed.unreachableRetry" : "groups.explore.empty")}
            </Text>
          )
        }
        ListFooterComponent={
          search.isFetchingNextPage ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
          ) : null
        }
      />

      <GroupFormSheet
        visible={creating}
        mode="create"
        onClose={() => setCreating(false)}
        onDone={(id) => {
          setCreating(false);
          onOpenGroup(id, false);
        }}
      />
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 52,
      paddingHorizontal: theme.spacing(1),
      gap: theme.spacing(1),
    },
    headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    title: { flex: 1, ...theme.typography.title, color: theme.colors.textPrimary },
    plus: {
      width: 30,
      height: 30,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    searchField: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      marginHorizontal: theme.spacing(4),
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
    error: {
      ...theme.typography.caption,
      color: theme.colors.danger,
      textAlign: "center",
      marginHorizontal: theme.spacing(4),
      marginBottom: theme.spacing(2),
    },
    section: {
      ...theme.typography.caption,
      color: theme.colors.textFaint,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginHorizontal: theme.spacing(4),
      marginTop: theme.spacing(2),
      marginBottom: theme.spacing(1),
    },
    loader: { marginVertical: theme.spacing(6) },
    empty: {
      ...theme.typography.bodySmall,
      color: theme.colors.textFaint,
      textAlign: "center",
      marginTop: theme.spacing(6),
      paddingHorizontal: theme.spacing(6),
    },
  });
}
