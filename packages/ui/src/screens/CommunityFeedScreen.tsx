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
//  - The second `useFocusEffect` (screen-focus gate + `markCommunitySeen`):
//    `markCommunitySeen` is store-based, a host concern. The focus gate on
//    new-post polling comes back as the `isFocused` prop (the host owns the
//    router), alongside the `AppState` foreground/background gate.
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
//    `FlatList`'s `ListHeaderComponent`. Eve's floating compose bar is kept:
//    once the inline composer scrolls out of view a pill appears at the
//    bottom; tapping it scrolls back up and calls `ComposerCard`'s `focus()`
//    (which opens the rules gate instead while still locked). Hidden while
//    searching, like the source.
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
//  - Post creation's "rejected by moderation" notice: `ComposerCard.submit()`
//    originally called `useCreatePost().mutate(...)` with no success/error
//    callback (Task 11), leaving this screen with no signal to key a
//    `NoticeCard` off — a regression from both sources, which show one.
//    Fixed in Task 12's review round (cross-file touch to `ComposerCard.tsx`
//    explicitly authorized there): `ComposerCard` now takes an optional
//    `onModerationRejected?: (kind: "post") => void`, called from its own
//    `mutate(...)`'s `onSuccess` when the verdict is `"rejected"`; this
//    screen wires it to `setNotice("rejected")` and renders `NoticeCard`.
//  - `onOpenInbox`: not in either source (Eve's bell lives on its Home tab,
//    outside the community screen entirely). Rendered as an optional bell
//    button next to the search toggle, shown only when both the prop is
//    given and `cfg.modules.inbox` is on — a host wires it to Task 13's
//    `NotificationInboxScreen`.

import {
  COMMUNITY_EVENTS,
  displayName,
  emitEvent,
  newestCreatedAt,
  useBlockUser,
  useCommunityConfig,
  useCommunityFeed,
  useDeleteContent,
  useMyUid,
  useNewPostsCount,
  useProfile,
  useSearchPosts,
  type FeedPost,
  type LocalImage,
  useUnreadNotificationCount,
} from "@rocapine/community-core";
import { Image } from "expo-image";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { CommunityPost, type PostSlots, type ProfileSource } from "../components/CommunityPost";
import { ImageViewerHost } from "../components/ImageViewer";
import { ComposerCard, type ComposerCardHandle } from "../components/ComposerCard";
import { ReportSheet, type ReportTarget } from "../components/ReportSheet";
import { NoticeCard } from "../components/NoticeCard";
import { PressableScale } from "../components/PressableScale";
import { isQueryLoading } from "../utils/query";
import { uniqueById } from "../utils/pages";
import { ThreadSheet } from "./ThreadSheet";

export function CommunityFeedScreen({
  onOpenProfile,
  onOpenInbox,
  isFocused = true,
  header,
  slots,
  beforeSubmitPost,
  beforeSubmitComment,
}: {
  onOpenProfile(userId: string, source?: ProfileSource): void;
  onOpenInbox?: () => void;
  /** Whether this screen is the one on display. A host whose navigator keeps
   * it mounted while hidden (tabs) passes its focus state, so new-post
   * polling stops while the user is on another tab. Defaults to `true`. */
  isFocused?: boolean;
  header?: ReactNode;
  slots?: PostSlots;
  /** Forwarded to this screen's own `ComposerCard` as `beforeSubmit` — see
   * that prop's doc comment. Absent ⇒ byte-identical behavior. */
  beforeSubmitPost?: (draft: {
    topic: string;
    body: string;
    pollOptions?: string[];
    image?: LocalImage;
  }) => Promise<boolean>;
  /** Forwarded to this screen's own `ThreadSheet` as `beforeSubmitComment` —
   * see that prop's doc comment. Absent ⇒ byte-identical behavior. */
  beforeSubmitComment?: (draft: {
    postId: string;
    body: string;
    image?: LocalImage;
  }) => Promise<boolean>;
}) {
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);

  const [filter, setFilter] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activePostId, setActivePostId] = useState<string | null>(null);
  // Opened from a post's comment button: land in the reply field.
  const [focusComment, setFocusComment] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [notice, setNotice] = useState<"rejected" | "network" | null>(null);

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

  // The field updates at once; the list (switching to/from results) follows
  // when React has time — clearing the field must feel instant.
  const deferredTerm = useDeferredValue(searchTerm);
  const searchActive = searchOpen && deferredTerm.trim().length >= 2;
  const topicFilter = filter === "all" ? undefined : filter;
  const categoryFeed = useCommunityFeed(topicFilter, !searchActive);
  const searchFeed = useSearchPosts(searchActive ? deferredTerm : "");

  // `useCommunityFeed` and `useSearchPosts` are both infinite queries
  // (`.data.pages`) — the search branch used to be a single flat query, but
  // pagination for user posts and search was added back (product decision,
  // reversing the earlier scope cut), so every derived field below can now
  // branch on `searchActive` between two values of the same shape instead of
  // two different shapes. Memoized (both source apps did too —
  // `useMemo(() => feed.data?.pages.flat() ?? [], [feed.data])`): without it,
  // `posts` is a brand-new array identity on every render (e.g. every 5s
  // new-post poll tick), which would defeat `FlatList`'s own `data`-identity
  // diffing and the `renderItem`/`CommunityPost` memoization below.
  const posts: FeedPost[] = useMemo(
    () =>
      searchActive ? uniqueById(searchFeed.data?.pages) : uniqueById(categoryFeed.data?.pages),
    [searchActive, searchFeed.data, categoryFeed.data],
  );
  // `isPending` alone (TanStack Query v5: `status === "pending"`) stays true
  // forever for a query that never runs — both `useCommunityFeed` and
  // `useSearchPosts` set `enabled: cfg.supabase !== null && ...`, so in
  // degraded mode (no `supabase` client, task brief §"degraded mode") the
  // query sits at `status: "pending"` / `fetchStatus: "idle"` permanently.
  // `isQueryLoading` (shared with the other screens hitting the same
  // hazard — profile/userPosts/thread/inbox) gates on `fetchStatus !==
  // "idle"` too, so "never asked to fetch" falls through to the plain
  // empty-state text below instead of spinning forever — required for the
  // degraded-mode acceptance test (empty state, not an infinite spinner).
  const isPending = searchActive ? isQueryLoading(searchFeed) : isQueryLoading(categoryFeed);
  const isError = searchActive ? searchFeed.isError : categoryFeed.isError;
  const activeFeed = searchActive ? searchFeed : categoryFeed;
  const hasNextPage = !!activeFeed.hasNextPage;
  const isFetchingNextPage = activeFeed.isFetchingNextPage;
  const refetch = () => (searchActive ? searchFeed.refetch() : categoryFeed.refetch());
  // The spinner only answers a pull: a background refetch (e.g. back from a
  // search) must not push the list down.
  const [pulling, setPulling] = useState(false);
  const pullToRefresh = () => {
    setPulling(true);
    refetch().finally(() => setPulling(false));
  };
  const loadMore = () => {
    if (activeFeed.hasNextPage && !activeFeed.isFetchingNextPage) {
      activeFeed.fetchNextPage();
    }
  };

  // New-post polling pauses while hidden (`isFocused`), backgrounded, or
  // searching (the search result set is not a simple newest-first topic
  // window).
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);
  const polling = isFocused && appActive && !searchActive;
  const sinceIso = newestCreatedAt(posts);
  const newCount = useNewPostsCount(sinceIso, topicFilter, polling);

  const listRef = useRef<FlatList<FeedPost>>(null);
  const composerRef = useRef<ComposerCardHandle>(null);
  const insets = useSafeAreaInsets();

  // Floating compose bar: shown once the inline composer (the list header,
  // so it starts at offset 0) has fully scrolled out of view.
  const composerBottom = useRef(140);
  const [composerHidden, setComposerHidden] = useState(false);
  const showFloatingCompose = composerHidden && !searchOpen;
  const myUid = useMyUid();
  const myAvatarUrl = useProfile(myUid).data?.avatarUrl ?? null;
  const myInitial = displayName(cfg.host.getDisplayName(), cfg.authorFallback())
    .charAt(0)
    .toUpperCase();
  const focusComposer = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    // Let the scroll-to-top land before the keyboard (or rules sheet) opens.
    setTimeout(() => composerRef.current?.focus(), 320);
  };

  const showNewPosts = () => {
    refetch();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const searchInputRef = useRef<TextInput>(null);
  const clearSearch = () => {
    // Native clear too: with a predictive-text word pending, iOS puts it back
    // when only the JS value is reset, so the first tap seemed to do nothing.
    searchInputRef.current?.clear();
    setSearchTerm("");
  };

  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) setSearchTerm("");
      return !open;
    });
  };

  // Memoized: passed straight through to `renderItem` below, which is itself
  // memoized — an unmemoized callback here would still force `FlatList` to
  // reconcile every visible row on each unrelated re-render (e.g. every 5s
  // new-post poll tick, or a keystroke in the search bar).
  const openThread = useCallback((postId: string) => {
    // Leaving the composer: it must not grab the keyboard back once the sheet closes.
    Keyboard.dismiss();
    setFocusComment(false);
    setActivePostId(postId);
  }, []);
  const openThreadToComment = useCallback((postId: string) => {
    Keyboard.dismiss();
    setFocusComment(true);
    setActivePostId(postId);
  }, []);

  const openPostMenu = useCallback(
    (post: FeedPost) => {
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
    },
    [t, deleteContent, blockUser],
  );

  // Memoized so `FlatList` only reconciles the visible window when one of
  // these actually changes, not on every parent re-render (poll ticks,
  // search typing, …). `slots` is out of our control — a host that passes a
  // fresh object literal on every render defeats this, same as any other
  // memoized-child pattern.
  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <CommunityPost
        post={item}
        onOpenThread={openThread}
        onPressComment={openThreadToComment}
        onOpenProfile={onOpenProfile}
        onMenu={openPostMenu}
        {...slots}
      />
    ),
    [openThread, openThreadToComment, onOpenProfile, openPostMenu, slots],
  );

  // An `officialOnly` filter (e.g. "News") must never become the composer's
  // preselected topic — regular users cannot post there.
  const composeDefaultTopic =
    topicFilter && !cfg.isOfficialTopic(topicFilter) ? topicFilter : undefined;

  return (
    <ImageViewerHost>
      <View style={styles.root}>
        {header}

        <View style={styles.controls}>
          <View style={styles.controlsRow}>
            {cfg.modules.inbox && onOpenInbox && <InboxBell onPress={onOpenInbox} />}
            <Pressable
              onPress={toggleSearch}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel={searchOpen ? t("a11y.closeSearch") : t("a11y.search")}
            >
              {searchOpen ? (
                <icons.close size={22} color={theme.colors.textPrimary} weight="bold" />
              ) : (
                <icons.search size={22} color={theme.colors.textPrimary} weight="regular" />
              )}
            </Pressable>
          </View>

          {/* Search bar and filter chips share one fixed-height slot, so
            toggling between them never shifts the feed. */}
          <View style={styles.switchRow}>
            {searchOpen ? (
              <View style={styles.searchBar}>
                <icons.search size={16} color={theme.colors.textFaint} weight="regular" />
                <TextInput
                  ref={searchInputRef}
                  value={searchTerm}
                  onChangeText={setSearchTerm}
                  placeholder={t("feed.searchPlaceholder")}
                  placeholderTextColor={theme.colors.textFaint}
                  autoFocus
                  returnKeyType="search"
                  style={styles.searchInput}
                />
                {searchTerm.length > 0 && (
                  <Pressable
                    hitSlop={10}
                    onPress={clearSearch}
                    style={styles.clearButton}
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.clearSearch")}
                  >
                    <icons.close size={12} color={theme.colors.surface} weight="bold" />
                  </Pressable>
                )}
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filtersScroll}
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
        </View>

        <View style={styles.listWrap}>
          {newCount > 0 && (
            <PressableScale onPress={showNewPosts} style={styles.newPill}>
              <Text style={styles.newPillText}>{t("feed.newPosts", { count: newCount })}</Text>
            </PressableScale>
          )}

          <FlatList
            ref={listRef}
            data={posts}
            keyExtractor={(p) => p.id}
            renderItem={renderItem}
            ListHeaderComponent={
              <>
                {/* Same gap above the results as the composer's own top margin. */}
                {searchOpen && <View style={styles.searchGap} />}
                {/* A search shows results only. Hidden, not unmounted: a draft survives it. */}
                <View
                  style={searchOpen && styles.hidden}
                  onLayout={(e) =>
                    (composerBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height)
                  }
                >
                  <ComposerCard
                    ref={composerRef}
                    defaultTopic={composeDefaultTopic}
                    onModerationRejected={() => setNotice("rejected")}
                    onPublishFailed={() => setNotice("network")}
                    beforeSubmit={beforeSubmitPost}
                  />
                </View>
              </>
            }
            onScroll={(e) =>
              setComposerHidden(e.nativeEvent.contentOffset.y > composerBottom.current)
            }
            scrollEventThrottle={32}
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
                <PressableScale onPress={loadMore} style={styles.loadMore}>
                  {isFetchingNextPage ? (
                    <ActivityIndicator size="small" color={theme.colors.accent} />
                  ) : (
                    <Text style={styles.loadMoreText}>{t("feed.loadMore")}</Text>
                  )}
                </PressableScale>
              ) : null
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            refreshControl={
              <RefreshControl
                refreshing={pulling}
                onRefresh={pullToRefresh}
                tintColor={theme.colors.accent}
              />
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.listContent,
              // Room for the floating compose bar under the last post.
              {
                paddingBottom:
                  insets.bottom + theme.spacing(3.5) + FLOATING_BAR_HEIGHT + theme.spacing(4),
              },
            ]}
          />

          {showFloatingCompose && (
            <Animated.View
              entering={FadeInDown.duration(180)}
              exiting={FadeOutDown.duration(140)}
              style={[styles.floatingCompose, { bottom: insets.bottom + theme.spacing(3.5) }]}
            >
              <PressableScale onPress={focusComposer} style={styles.composeBar}>
                {myAvatarUrl ? (
                  <Image
                    source={{ uri: myAvatarUrl }}
                    style={styles.composeAvatarImage}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.composeAvatar}>
                    <Text style={styles.composeAvatarLetter}>{myInitial}</Text>
                  </View>
                )}
                <Text style={styles.composePrompt} numberOfLines={1}>
                  {t("feed.composePrompt")}
                </Text>
                <icons.compose size={18} color={theme.colors.accent} weight="regular" />
              </PressableScale>
            </Animated.View>
          )}
        </View>

        <ThreadSheet
          postId={activePostId}
          focusComment={focusComment}
          onClose={() => setActivePostId(null)}
          onOpenProfile={onOpenProfile}
          slots={slots}
          beforeSubmitComment={beforeSubmitComment}
        />
        <ReportSheet
          visible={reportTarget !== null}
          target={reportTarget}
          onClose={() => setReportTarget(null)}
        />
        {notice && <NoticeCard kind={notice} onDismiss={() => setNotice(null)} />}
      </View>
    </ImageViewerHost>
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
    <PressableScale
      haptic={active ? undefined : "selection"}
      onPress={onPress}
      style={[styles.filterChip, active && styles.filterChipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextOn]}>{label}</Text>
    </PressableScale>
  );
}

/**
 * The inbox entry point, with an unread dot — the only badge the SDK renders
 * itself (`useUnreadNotificationCount`). Its own component so the inbox query
 * only runs when the inbox module is on and the host wired `onOpenInbox`.
 */
function InboxBell({ onPress }: { onPress: () => void }) {
  const theme = useCommunityTheme();
  const t = useT();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const unread = useUnreadNotificationCount();
  return (
    <Pressable
      onPress={onPress}
      style={styles.iconButton}
      accessibilityRole="button"
      accessibilityLabel={t("inbox.title")}
    >
      <icons.bell size={22} color={theme.colors.textPrimary} weight="regular" />
      {unread > 0 && <View style={styles.bellDot} />}
    </Pressable>
  );
}

/** Minimum touch target (Apple HIG / Material: 44pt / 48dp). */
const ICON_TARGET = 44;
/** Shared by the filter chips and the search bar that replaces them. */
const CONTROL_HEIGHT = 40;
const FLOATING_BAR_HEIGHT = 54;

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    controls: {
      paddingHorizontal: theme.spacing(5),
      paddingTop: theme.spacing(1),
      paddingBottom: theme.spacing(3),
    },
    // Icons sit flush with the content edge; each keeps a 44pt target.
    controlsRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: theme.spacing(1),
      marginRight: -(ICON_TARGET - 22) / 2,
    },
    iconButton: {
      width: ICON_TARGET,
      height: ICON_TARGET,
      alignItems: "center",
      justifyContent: "center",
    },
    bellDot: {
      position: "absolute",
      top: 10,
      right: 10,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.accent,
      borderWidth: 1.5,
      borderColor: theme.colors.background,
    },
    switchRow: { height: CONTROL_HEIGHT, marginTop: theme.spacing(2) },
    searchBar: {
      height: CONTROL_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing(3.5),
    },
    searchInput: {
      flex: 1,
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 15,
      color: theme.colors.textPrimary,
      padding: 0,
    },
    clearButton: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: theme.colors.textFaint,
      alignItems: "center",
      justifyContent: "center",
    },
    // Bleeds past the screen padding so chips scroll edge to edge.
    filtersScroll: { marginHorizontal: -theme.spacing(5) },
    filters: {
      flexDirection: "row",
      gap: theme.spacing(2),
      paddingHorizontal: theme.spacing(5),
    },
    filterChip: {
      height: CONTROL_HEIGHT,
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing(4),
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    filterChipOn: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
    filterChipText: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 12.5,
      color: theme.colors.textMuted,
    },
    filterChipTextOn: { color: theme.colors.accent },
    listWrap: { flex: 1, position: "relative" },
    hidden: { display: "none" },
    // = ComposerCard's marginTop: results start where the composer would.
    searchGap: { height: theme.spacing(4) },
    listContent: { paddingHorizontal: theme.spacing(5) },
    spinner: { marginTop: theme.spacing(8) },
    stateText: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
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
    loadMoreText: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
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
    floatingCompose: {
      position: "absolute",
      left: theme.spacing(5),
      right: theme.spacing(5),
      ...theme.shadow,
    },
    composeBar: {
      height: FLOATING_BAR_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing(3),
    },
    composeAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    composeAvatarImage: { width: 32, height: 32, borderRadius: 16 },
    composeAvatarLetter: {
      fontFamily: theme.fonts.serifBold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 14,
      color: theme.colors.accent,
    },
    composePrompt: {
      flex: 1,
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    newPillText: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 13,
      color: theme.colors.textInverse,
    },
  });
}
