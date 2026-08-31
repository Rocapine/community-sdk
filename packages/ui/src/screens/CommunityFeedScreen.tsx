// The community feed: topic filter chips, search, a "N new posts" pill, the
// inline composer, an infinite-scrolling `FlatList` of posts, and the thread/
// report-sheet orchestration that opening a post or its menu needs. Ported
// from the mold's `app/community.tsx` (route → component), merged with Eve's
// Rhythm's newer `app/(app)/(tabs)/community.tsx` for the search bar and the
// "N new posts" pill (Eve's own reaction/prayer wiring is not merged here —
// see below).
//
// Router-free transformations (task brief):
//  - `useFocusEffect(... trackCommunityOpened ...)` → a plain mount `useEffect`
//    that calls `emitEvent(cfg, COMMUNITY_EVENTS.opened)` — neither source's
//    hardcoded `"toolbox"`/`"tab"` open-source string is meaningful here (this
//    package doesn't know how the host navigated in), so no `source` prop is
//    emitted; a host that wants one can still emit its own from `cfg.host.onEvent`.
//  - The second `useFocusEffect` (screen-focus gate + `markCommunitySeen`) is
//    dropped entirely: `markCommunitySeen` is store-based, an explicit
//    out-of-scope "host concern" per the task brief. Only the `AppState`
//    foreground/background gate on new-post polling is kept (plain RN API,
//    no router/store dependency).
//  - `router.push(...)`/`router.back()` → `onOpenProfile(userId)` /
//    the `header` prop (the app renders its own top bar, including any back
//    button — this screen never had one of its own to begin with in the
//    tab-bar-hosted Eve source this was reconciled against).
//  - `router.push(/user/...)` for the compose sheet, filter chips and the
//    optimistic-post `authorId` guard all still apply verbatim through
//    `onOpenProfile`.
//
// Differences from both sources, beyond the standard reconciliation:
//  - No separate compose "bar + 90%-sheet" flow: `ComposerCard` (Task 11) is
//    already the full inline composer (topic chips, poll editor, its own
//    rules gate + embedded `RulesSheet`) — it renders directly as the
//    `FlatList`'s `ListHeaderComponent`. This also means the mold/Eve's
//    "floating compose pill that scrolls up and focuses the composer" has no
//    equivalent here: `ComposerCard` dropped its imperative `focus()` API in
//    Task 11 (brief: plain function component, no ref) — nothing to focus
//    from a floating pill. Not replaced.
//  - `ScrollView`-based `Screen` → a plain `FlatList` per the brief ("FlatList
//    feed"), with `RefreshControl` for pull-to-refresh and `onEndReached` for
//    infinite scroll instead of a manual "Load more" scroll position.
//    A "Load more" footer button is still shown for parity with both
//    sources' explicit affordance, alongside `onEndReached`.
//  - Filter chips read the full `cfg.topics` (including any `officialOnly`
//    ones, e.g. a "News" topic) — that's the *browsing* list, distinct from
//    `cfg.composeTopics()` (which `ComposerCard` uses and which excludes
//    them). `defaultTopic` passed to `ComposerCard` is only ever a non-official
//    topic id (or `undefined`): passing an `officialOnly` filter straight
//    through would preselect a topic regular users cannot post to.
//  - The reaction ("pray for") affordance is not wired here at all: it lives
//    entirely inside `CommunityPost` (Task 9) via `cfg.modules.reaction` +
//    `useReactToPost`, gone the moment a host turns that module on — nothing
//    left for this screen to wire. Eve's app-specific `PrayForSisterSheet`
//    (third-person prayer flow) is explicitly out of scope per the brief
//    ("SKIP Eve's prayer-sheet flow — that's an app-side slot concern"); a
//    host wanting that can build it as a `renderReactionButton`/
//    `renderPostFooter` slot via `PostSlots`.
//  - Post creation's "rejected by moderation" notice has no equivalent here:
//    `ComposerCard.submit()` calls `useCreatePost().mutate(...)` with no
//    success/error callback (Task 11), so this screen has no signal to key a
//    `NoticeCard` off. Reopening that (adding an `onRejected`/`onError` slot
//    to `ComposerCard`) would touch a file outside this task's list — flagged
//    as a known gap, not fixed here. (`ThreadSheet`'s own comment composer,
//    written fresh in this task, does not have this gap.)
//  - `onOpenInbox`: not in either source (Eve's bell lives on its Home tab,
//    outside the community screen entirely). Rendered as an optional bell
//    button next to the search toggle, shown only when both the prop is
//    given and `cfg.modules.inbox` is on — a host wires it to Task 13's
//    `NotificationInboxScreen`.

import {
  COMMUNITY_EVENTS,
  emitEvent,
  newestCreatedAt,
  useBlockUser,
  useCommunityConfig,
  useCommunityFeed,
  useDeleteContent,
  useNewPostsCount,
  useSearchPosts,
  type FeedPost,
} from "@rocapine/community-core";
import * as Haptics from "expo-haptics";
import { Bell, MagnifyingGlass, X } from "phosphor-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { CommunityPost, type PostSlots } from "../components/CommunityPost";
import { ComposerCard } from "../components/ComposerCard";
import { ReportSheet } from "../components/ReportSheet";
import { ThreadSheet } from "./ThreadSheet";

type ReportTarget = { kind: "post" | "comment"; id: string; authorId: string };

export function CommunityFeedScreen({
  onOpenProfile,
  onOpenInbox,
  header,
  slots,
}: {
  onOpenProfile(userId: string): void;
  onOpenInbox?: () => void;
  header?: ReactNode;
  slots?: PostSlots;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);

  const [filter, setFilter] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const blockUser = useBlockUser();
  const deleteContent = useDeleteContent();

  useEffect(() => {
    emitEvent(cfg, COMMUNITY_EVENTS.opened);
    // Mount-only: the mold/Eve fire this from a `useFocusEffect` (screen
    // gains focus); this component has no router-provided focus signal, so
    // it fires once, matching the brief's "useFocusEffect -> useEffect on
    // mount" transformation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchActive = searchOpen && searchTerm.trim().length >= 2;
  const topicFilter = filter === "all" ? undefined : filter;
  const categoryFeed = useCommunityFeed(topicFilter, !searchActive);
  const searchFeed = useSearchPosts(searchActive ? searchTerm : "");

  // `useCommunityFeed` is an infinite query (`.data.pages`); `useSearchPosts`
  // is a single flat query (`.data`) — Task 5 ruling, search is unpaginated
  // at the service layer. Branch on every derived field instead of forcing
  // both into one variable of a shared (and untrue) shape.
  const posts: FeedPost[] = searchActive
    ? (searchFeed.data ?? [])
    : (categoryFeed.data?.pages.flat() ?? []);
  const isPending = searchActive ? searchFeed.isPending : categoryFeed.isPending;
  const isError = searchActive ? searchFeed.isError : categoryFeed.isError;
  const isRefetching = searchActive ? searchFeed.isRefetching : categoryFeed.isRefetching;
  const hasNextPage = !searchActive && !!categoryFeed.hasNextPage;
  const isFetchingNextPage = !searchActive && categoryFeed.isFetchingNextPage;
  const refetch = () => {
    if (searchActive) searchFeed.refetch();
    else categoryFeed.refetch();
  };
  const loadMore = () => {
    if (!searchActive && categoryFeed.hasNextPage && !categoryFeed.isFetchingNextPage) {
      categoryFeed.fetchNextPage();
    }
  };

  // New-post polling pauses while backgrounded or while searching (the
  // search result set is not a simple newest-first topic window). No
  // screen-focus gate: see the router-free transformation note above.
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);
  const polling = appActive && !searchActive;
  const sinceIso = newestCreatedAt(posts);
  const newCount = useNewPostsCount(sinceIso, topicFilter, polling);

  const listRef = useRef<FlatList<FeedPost>>(null);
  const showNewPosts = () => {
    Haptics.selectionAsync().catch(() => {});
    refetch();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const toggleSearch = () => {
    Haptics.selectionAsync().catch(() => {});
    setSearchOpen((open) => {
      if (open) setSearchTerm("");
      return !open;
    });
  };

  const openThread = (postId: string) => {
    Haptics.selectionAsync().catch(() => {});
    setActivePostId(postId);
  };

  const openPostMenu = (post: FeedPost) => {
    Haptics.selectionAsync().catch(() => {});
    if (post.isOwn) {
      Alert.alert(t("menu.deletePostTitle"), t("menu.deletePostBody"), [
        { text: t("menu.cancel"), style: "cancel" },
        {
          text: t("menu.delete"),
          style: "destructive",
          onPress: () => deleteContent.mutate({ kind: "post", id: post.id, postId: post.id }),
        },
      ]);
      return;
    }
    Alert.alert(post.authorName, undefined, [
      {
        text: t("menu.reportPost"),
        onPress: () => setReportTarget({ kind: "post", id: post.id, authorId: post.authorId }),
      },
      {
        text: t("menu.blockUser", { name: post.authorName }),
        style: "destructive",
        onPress: () =>
          Alert.alert(
            t("menu.blockUserConfirmTitle", { name: post.authorName }),
            t("menu.blockUserConfirmBody"),
            [
              { text: t("menu.cancel"), style: "cancel" },
              {
                text: t("menu.block"),
                style: "destructive",
                onPress: () => blockUser.mutate({ userId: post.authorId }),
              },
            ],
          ),
      },
      { text: t("menu.cancel"), style: "cancel" },
    ]);
  };

  // An `officialOnly` filter (e.g. "News") must never become the composer's
  // preselected topic — regular users cannot post there.
  const composeDefaultTopic =
    topicFilter && !cfg.isOfficialTopic(topicFilter) ? topicFilter : undefined;

  return (
    <View style={styles.root}>
      {header}

      <View style={styles.controls}>
        <View style={styles.controlsRow}>
          <View style={styles.controlsSpacer} />
          {cfg.modules.inbox && onOpenInbox && (
            <Pressable hitSlop={10} onPress={onOpenInbox} style={styles.iconButton}>
              <Bell size={20} color={theme.colors.textPrimary} weight="regular" />
            </Pressable>
          )}
          <Pressable hitSlop={10} onPress={toggleSearch} style={styles.iconButton}>
            {searchOpen ? (
              <X size={20} color={theme.colors.textPrimary} weight="bold" />
            ) : (
              <MagnifyingGlass size={20} color={theme.colors.textPrimary} weight="regular" />
            )}
          </Pressable>
        </View>

        {searchOpen ? (
          <View style={styles.searchBar}>
            <MagnifyingGlass size={16} color={theme.colors.textFaint} weight="regular" />
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder={t("feed.searchPlaceholder")}
              placeholderTextColor={theme.colors.textFaint}
              autoFocus
              returnKeyType="search"
              style={styles.searchInput}
            />
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            <FilterChip
              label={t("feed.all")}
              active={filter === "all"}
              onPress={() => setFilter("all")}
            />
            {cfg.topics.map((topic) => (
              <FilterChip
                key={topic.id}
                label={t(`topics.${topic.id}`)}
                active={filter === topic.id}
                onPress={() => setFilter(topic.id)}
              />
            ))}
          </ScrollView>
        )}
      </View>

      <View style={styles.listWrap}>
        {newCount > 0 && (
          <Pressable onPress={showNewPosts} style={styles.newPill}>
            <Text style={styles.newPillText}>{t("feed.newPosts", { count: newCount })}</Text>
          </Pressable>
        )}

        <FlatList
          ref={listRef}
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <CommunityPost
              post={item}
              onOpenThread={openThread}
              onOpenProfile={onOpenProfile}
              onMenu={openPostMenu}
              {...slots}
            />
          )}
          ListHeaderComponent={<ComposerCard defaultTopic={composeDefaultTopic} />}
          ListEmptyComponent={
            isPending ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
            ) : isError ? (
              <Text style={styles.stateText}>{t("feed.unreachableRetry")}</Text>
            ) : (
              <Text style={styles.stateText}>
                {searchActive
                  ? t("feed.noSearchResults")
                  : filter === "news"
                    ? t("feed.newsEmpty")
                    : t("feed.empty")}
              </Text>
            )
          }
          ListFooterComponent={
            hasNextPage ? (
              <Pressable onPress={loadMore} style={styles.loadMore}>
                {isFetchingNextPage ? (
                  <ActivityIndicator size="small" color={theme.colors.accent} />
                ) : (
                  <Text style={styles.loadMoreText}>{t("feed.loadMore")}</Text>
                )}
              </Pressable>
            ) : null
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isFetchingNextPage}
              onRefresh={refetch}
              tintColor={theme.colors.accent}
            />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      </View>

      <ThreadSheet
        postId={activePostId}
        onClose={() => setActivePostId(null)}
        onOpenProfile={onOpenProfile}
        slots={slots}
      />
      <ReportSheet
        visible={reportTarget !== null}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
      />
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={[styles.filterChip, active && styles.filterChipOn]}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    controls: {
      paddingHorizontal: theme.spacing(5),
      paddingTop: theme.spacing(1),
      paddingBottom: theme.spacing(3),
    },
    controlsRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1) },
    controlsSpacer: { flex: 1 },
    iconButton: { padding: theme.spacing(1.5) },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      marginTop: theme.spacing(3),
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2.25),
    },
    searchInput: {
      flex: 1,
      fontFamily: theme.fonts.regular,
      fontSize: 15,
      color: theme.colors.textPrimary,
      padding: 0,
    },
    filters: {
      flexDirection: "row",
      gap: theme.spacing(2),
      marginTop: theme.spacing(3),
      paddingRight: theme.spacing(1),
    },
    filterChip: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2),
      paddingHorizontal: theme.spacing(3.5),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    filterChipOn: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
    filterChipText: {
      fontFamily: theme.fonts.medium,
      fontSize: 12.5,
      color: theme.colors.textMuted,
    },
    filterChipTextOn: { color: theme.colors.accent },
    listWrap: { flex: 1, position: "relative" },
    listContent: { paddingHorizontal: theme.spacing(5), paddingBottom: theme.spacing(8) },
    spinner: { marginTop: theme.spacing(8) },
    stateText: {
      fontFamily: theme.fonts.regular,
      fontSize: 13.5,
      color: theme.colors.textMuted,
      textAlign: "center",
      marginTop: theme.spacing(8),
      marginBottom: theme.spacing(2),
    },
    loadMore: {
      alignSelf: "center",
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2.5),
      paddingHorizontal: theme.spacing(5),
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginTop: theme.spacing(1),
      marginBottom: theme.spacing(3),
      minWidth: 96,
      alignItems: "center",
    },
    loadMoreText: { fontFamily: theme.fonts.medium, fontSize: 13, color: theme.colors.textMuted },
    newPill: {
      position: "absolute",
      top: theme.spacing(2),
      alignSelf: "center",
      zIndex: 1,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2),
      paddingHorizontal: theme.spacing(4.5),
      ...theme.shadow,
    },
    newPillText: { fontFamily: theme.fonts.bold, fontSize: 13, color: theme.colors.textInverse },
  });
}
