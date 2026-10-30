// The community feed: scrollable topic tabs, search, a "N new posts" pill, a
// flat infinite-scrolling `FlatList` of posts, the `+` button that opens the
// full-screen composer, and the thread/report-sheet orchestration that
// opening a post or its menu needs. Ported from the mold's `app/community.tsx`
// (route → component), merged with Eve's Rhythm's newer community screen for
// the search bar, the "N new posts" pill, the tabs and the `+` composer.
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
//    button).
//
// Differences from both sources, beyond the standard reconciliation:
//  - Composing: the `+` button runs the gates first (rules, then the host's
//    `beforeCompose`), then opens `ComposerSheet`, mounted once here so a
//    draft survives a close. Hidden while searching.
//  - `ScrollView`-based `Screen` → a plain `FlatList`, with `RefreshControl`
//    for pull-to-refresh and `onEndReached` for infinite scroll; a "Load more"
//    footer button is still shown for parity with both sources.
//  - The tabs read the full `cfg.topics` (including any `officialOnly` ones,
//    e.g. a "News" topic) — that's the *browsing* list, distinct from
//    `cfg.composeTopics()` (which the composer uses and which excludes them).
//    The composer's `defaultTopic` is only ever a non-official topic id (or
//    `undefined`): an `officialOnly` tab would preselect a topic regular
//    users cannot post to.
//  - The reaction ("pray for") affordance lives entirely inside
//    `CommunityPost` via `cfg.modules.reaction` + `useReactToPost`; a host
//    wanting Eve's third-person prayer flow builds it as a
//    `renderReactionButton`/`renderPostFooter` slot via `PostSlots`.
//  - Moderation and publish-failure notices: the composer reports them
//    (`onModerationRejected`, `onPublishFailed`) and this screen shows a
//    `NoticeCard`.
//  - `onOpenInbox`: not in either source (Eve's bell lives on its Home tab,
//    outside the community screen entirely). Rendered as an optional bell
//    button next to the search toggle, shown only when both the prop is
//    given and `cfg.modules.inbox` is on — a host wires it to Task 13's
//    `NotificationInboxScreen`.
//  - The header row (title + profile / search / inbox buttons) is laid out
//    by the `headerLayout` prop, so each app picks its own arrangement.

import {
  COMMUNITY_EVENTS,
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
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
} from "react-native";
import { Image } from "expo-image";
import Animated, {
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { CommunityPost, type PostSlots, type ProfileSource } from "../components/CommunityPost";
import { ImageViewerHost } from "../components/ImageViewer";
import { ComposerSheet } from "../components/ComposerSheet";
import { RulesSheet } from "../components/RulesSheet";
import { openComposerGuarded } from "../utils/gate";
import { useRulesAccepted } from "../utils/rulesAcceptance";
import { ReportSheet, type ReportTarget } from "../components/ReportSheet";
import { NoticeCard } from "../components/NoticeCard";
import { Avatar } from "../components/Avatar";
import { TABS_ROW_HEIGHT, TopicTabs } from "../components/TopicTabs";
import { PressableScale } from "../components/PressableScale";
import { isQueryLoading } from "../utils/query";
import { uniqueById } from "../utils/pages";
import { useMyAuthorName } from "../utils/myName";
import { ThreadSheet } from "./ThreadSheet";
import { noFocusRing } from "../utils/noFocusRing";

/** A button the feed's header row can show. `profile` (the user's avatar)
 * opens their own profile through `onOpenProfile`; `inbox` shows only when
 * the inbox module is on and `onOpenInbox` is given. */
export type FeedHeaderButton = "profile" | "search" | "inbox";

/** What the header row shows between its buttons: the "Community" title
 * (`title` i18n key) on the left or centred, an image in its place (e.g. the
 * app's logo — the host passes the source matching its theme), or nothing. */
export type FeedHeaderTitle =
  | "left"
  | "center"
  | false
  | { image: ImageSourcePropType; position?: "left" | "center"; accessibilityLabel?: string };

/** The feed's header row. Replaces the default as a whole: a side or title
 * left out is empty. */
export type FeedHeaderLayout = {
  left?: FeedHeaderButton[];
  right?: FeedHeaderButton[];
  title?: FeedHeaderTitle;
};

export const DEFAULT_FEED_HEADER_LAYOUT: FeedHeaderLayout = {
  left: ["profile"],
  title: "center",
  right: ["search", "inbox"],
};

export function CommunityFeedScreen({
  onOpenProfile,
  onOpenInbox,
  isFocused = true,
  header,
  headerLayout = DEFAULT_FEED_HEADER_LAYOUT,
  slots,
  beforeCompose,
  beforeSubmitComment,
  topicRequest,
  postRequest,
  bottomChrome,
}: {
  onOpenProfile(userId: string, source?: ProfileSource): void;
  onOpenInbox?: () => void;
  /** Whether this screen is the one on display. A host whose navigator keeps
   * it mounted while hidden (tabs) passes its focus state, so new-post
   * polling stops while the user is on another tab. Defaults to `true`. */
  isFocused?: boolean;
  header?: ReactNode;
  /** Buttons and title of the header row. Defaults to
   * `DEFAULT_FEED_HEADER_LAYOUT`. */
  headerLayout?: FeedHeaderLayout;
  slots?: PostSlots;
  /** Awaited when the `+` button is tapped, after the community rules are
   * accepted and before the composer opens (e.g. ask a signed-out user to
   * sign in). Resolving `false` (or throwing) keeps the composer closed, with
   * no error UI. Absent ⇒ the composer opens once the rules are accepted. */
  beforeCompose?: () => Promise<boolean>;
  /** Selects a topic's tab from outside, e.g. a topic tapped on a profile
   * the host navigated back from. Applied each time `requestedAt` changes, so
   * the same topic can be asked for twice; an id `cfg.topics` doesn't list is
   * ignored. */
  topicRequest?: { topicId: string; requestedAt: number };
  /** Opens a post's thread from outside, e.g. the post a tapped push is
   * about. Applied each time `requestedAt` changes. */
  postRequest?: { postId: string; requestedAt: number };
  /** A host bar floating over the feed's bottom (a tab bar) that hides with
   * the feed's top bar. `hidden` is written with how far the top bar is hidden
   * as the reader scrolls (0 shown → 1 hidden), for the host to slide its bar
   * by; `height` is what the bar covers when shown, bottom safe area included.
   * The list clears it and the `+` button rides on it, down to the safe area
   * once it is gone. Absent ⇒ the host's container clears its own bottom. */
  bottomChrome?: { height: number; hidden: SharedValue<number> };
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

  // Collapsing top (header row + tabs): it overlays the list and slides up
  // as the reader scrolls down, back as soon as they scroll up (quick return).
  // iOS offsets the content with `contentInset`, so the pull-to-refresh
  // spinner sits under the top bar; Android pads the content instead.
  const [topHeight, setTopHeight] = useState(0);
  const topH = useSharedValue(0);
  const hidden = useSharedValue(0);
  const lastY = useSharedValue(0);
  const insetsTop = Platform.OS === "ios";
  const toListTop = (animated: boolean) =>
    listRef.current?.scrollToOffset({ offset: insetsTop ? -topH.value : 0, animated });
  const onListScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y + (insetsTop ? topH.value : 0);
      const dy = y - lastY.value;
      lastY.value = y;
      hidden.value = y <= 0 ? 0 : Math.min(Math.max(hidden.value + dy, 0), topH.value);
    },
    // Never left half-shown: settle once the finger lifts without a fling,
    // or once the fling stops.
    onEndDrag: (e) => {
      if (Math.abs(e.velocity?.y ?? 0) > 0.1) return;
      hidden.value = withTiming(hidden.value > topH.value / 2 ? topH.value : 0, { duration: 180 });
    },
    onMomentumEnd: () => {
      hidden.value = withTiming(hidden.value > topH.value / 2 ? topH.value : 0, { duration: 180 });
    },
  });
  const topStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -hidden.value }] }));
  const chromeHidden = bottomChrome?.hidden;
  const chromeH = bottomChrome?.height ?? 0;
  useAnimatedReaction(
    () => (topH.value > 0 ? hidden.value / topH.value : 0),
    (progress) => {
      if (chromeHidden) chromeHidden.value = progress;
    },
  );
  // Leaving the feed (another tab, a pushed profile) brings both bars back.
  useEffect(() => {
    if (!isFocused) hidden.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);
  const bottomInset = useSafeAreaInsets().bottom;
  const fabDrop = bottomChrome ? Math.max(0, chromeH - bottomInset) : 0;
  const fabStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (chromeHidden?.value ?? 0) * fabDrop }],
  }));
  const pillStyle = useAnimatedStyle(() => ({ top: topH.value - hidden.value + 8 }));
  const myUid = useMyUid();
  const myAvatarUrl = useProfile(myUid).data?.avatarUrl ?? null;
  const myAuthorName = useMyAuthorName();

  // `+`: the rules, then the host gate, then the composer (see
  // `openComposerGuarded`). The rules sheet resolves once it has fully
  // dismissed, so a host gate that opens its own modal never overlaps it.
  const [composerOpen, setComposerOpen] = useState(false);
  const [rulesVisible, setRulesVisible] = useState(false);
  const rulesAccepted = useRulesAccepted(cfg);
  const rulesAnswer = useRef<{ accepted: boolean; resolve: (ok: boolean) => void } | null>(null);
  const opening = useRef(false);
  const requestRules = () =>
    new Promise<boolean>((resolve) => {
      rulesAnswer.current = { accepted: false, resolve };
      setRulesVisible(true);
    });
  const openComposer = () => {
    if (opening.current) return;
    opening.current = true;
    Keyboard.dismiss();
    openComposerGuarded({ rulesAccepted, requestRules, beforeCompose })
      .then((ok) => ok && setComposerOpen(true))
      .finally(() => (opening.current = false));
  };

  const showNewPosts = () => {
    refetch();
    toListTop(true);
  };

  const searchInputRef = useRef<TextInput>(null);
  const clearSearch = () => {
    // Native clear too: with a predictive-text word pending, iOS puts it back
    // when only the JS value is reset, so the first tap seemed to do nothing.
    searchInputRef.current?.clear();
    setSearchTerm("");
  };

  // A topic tapped on a post (in the feed, the search results or the
  // thread) or asked for by the host: leave the search, land on its tab.
  // Already on that tab (outside a search): nothing to do, keep the reader's place.
  const currentTab = useRef({ filter, searchOpen });
  currentTab.current = { filter, searchOpen };
  const selectTopic = useCallback((topicId: string) => {
    const now = currentTab.current;
    if (now.filter === topicId && !now.searchOpen) return;
    setSearchOpen(false);
    setSearchTerm("");
    setFilter(topicId);
    hidden.value = 0;
    toListTop(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const requestedTopic = topicRequest?.topicId;
  const requestedAt = topicRequest?.requestedAt;
  useEffect(() => {
    if (requestedTopic && cfg.topics.some((tp) => tp.id === requestedTopic)) {
      selectTopic(requestedTopic);
    }
    // Keyed on `requestedAt`: the same topic can be asked for twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedAt]);

  const toggleSearch = () => {
    hidden.value = 0;
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
  const requestedPost = postRequest?.postId;
  const postRequestedAt = postRequest?.requestedAt;
  useEffect(() => {
    if (requestedPost) openThread(requestedPost);
    // Keyed on `requestedAt`: the same post can be asked for twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postRequestedAt]);

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
        onPressTopic={selectTopic}
        {...slots}
      />
    ),
    [openThread, openThreadToComment, onOpenProfile, openPostMenu, selectTopic, slots],
  );

  const showButton = (b: FeedHeaderButton) => b !== "inbox" || (cfg.modules.inbox && !!onOpenInbox);
  const leftButtons = (headerLayout.left ?? []).filter(showButton);
  const rightButtons = (headerLayout.right ?? []).filter(showButton);
  const hasHeaderRow = leftButtons.length > 0 || rightButtons.length > 0 || !!headerLayout.title;
  const titleSpec = headerLayout.title;
  const titlePosition =
    typeof titleSpec === "object" && titleSpec ? (titleSpec.position ?? "center") : titleSpec;
  const title =
    typeof titleSpec === "object" && titleSpec ? (
      <Image
        source={titleSpec.image}
        style={styles.headerImage}
        contentFit="contain"
        accessible
        accessibilityRole="header"
        accessibilityLabel={titleSpec.accessibilityLabel}
      />
    ) : (
      <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
        {t("title")}
      </Text>
    );
  const renderHeaderButton = (button: FeedHeaderButton) => {
    switch (button) {
      case "profile":
        return (
          <PressableScale
            key={button}
            onPress={() => myUid && onOpenProfile(myUid)}
            disabled={!myUid}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t("a11y.myProfile")}
          >
            <Avatar userId={myUid} name={myAuthorName()} url={myAvatarUrl} size={32} />
          </PressableScale>
        );
      case "inbox":
        return <InboxBell key={button} onPress={onOpenInbox!} />;
      case "search":
        return (
          <PressableScale
            key={button}
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
          </PressableScale>
        );
    }
  };

  const topicTabs = useMemo(
    () => [
      { id: "all", label: t("feed.all") },
      ...cfg.topics.map((topic) => ({ id: topic.id, label: t(`topics.${topic.id}`) })),
    ],
    [cfg.topics, t],
  );

  // An `officialOnly` filter (e.g. "News") must never become the composer's
  // preselected topic — regular users cannot post there.
  const composeDefaultTopic =
    topicFilter && !cfg.isOfficialTopic(topicFilter) ? topicFilter : undefined;

  return (
    <ImageViewerHost>
      <View style={styles.root}>
        <Animated.View
          style={[styles.top, topStyle]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h === topH.value) return;
            const first = topH.value === 0;
            topH.value = h;
            setTopHeight(h);
            // iOS: the inset only starts applying now; land on the first post.
            if (first && insetsTop)
              listRef.current?.scrollToOffset({ offset: -h, animated: false });
          }}
        >
          {header}

          <View style={styles.controls}>
            {hasHeaderRow && (
              <View style={styles.headerRow}>
                <View style={styles.headerSide}>
                  {leftButtons.map(renderHeaderButton)}
                  {titlePosition === "left" && title}
                </View>
                {titlePosition === "center" && title}
                <View style={[styles.headerSide, styles.headerSideRight]}>
                  {rightButtons.map(renderHeaderButton)}
                </View>
              </View>
            )}
          </View>

          {/* Search bar and topic tabs share one fixed-height slot, so toggling
          between them never shifts the feed. */}
          <View style={styles.switchRow}>
            {searchOpen ? (
              <View style={styles.searchSlot}>
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
              </View>
            ) : (
              <TopicTabs tabs={topicTabs} selected={filter} onSelect={setFilter} />
            )}
          </View>
        </Animated.View>

        <View style={styles.listWrap}>
          {newCount > 0 && (
            <Animated.View style={[styles.newPill, pillStyle]}>
              <PressableScale onPress={showNewPosts} style={styles.newPillButton}>
                <Text style={styles.newPillText}>{t("feed.newPosts", { count: newCount })}</Text>
              </PressableScale>
            </Animated.View>
          )}

          <Animated.FlatList
            ref={listRef}
            onScroll={onListScroll}
            scrollEventThrottle={16}
            contentInset={insetsTop ? { top: topHeight } : undefined}
            scrollIndicatorInsets={
              insetsTop ? { top: topHeight, bottom: chromeH } : { bottom: chromeH }
            }
            automaticallyAdjustContentInsets={false}
            data={posts}
            keyExtractor={(p) => p.id}
            renderItem={renderItem}
            ItemSeparatorComponent={RowSeparator}
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
                progressViewOffset={topHeight}
              />
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            // Room for the `+` button under the last post. The host's
            // container clears the bottom safe area (and its tab bar).
            contentContainerStyle={{
              paddingTop: insetsTop ? 0 : topHeight,
              paddingBottom: chromeH + FAB_SIZE + theme.spacing(8),
            }}
          />

          {!searchOpen && (
            <Animated.View style={[styles.fab, { bottom: chromeH + theme.spacing(4) }, fabStyle]}>
              <PressableScale
                onPress={openComposer}
                style={styles.fabButton}
                accessibilityRole="button"
                accessibilityLabel={t("feed.compose")}
              >
                <icons.add size={26} color={theme.colors.textInverse} weight="bold" />
              </PressableScale>
            </Animated.View>
          )}
        </View>

        <ThreadSheet
          postId={activePostId}
          focusComment={focusComment}
          onClose={() => setActivePostId(null)}
          onOpenProfile={onOpenProfile}
          onPressTopic={selectTopic}
          slots={slots}
          beforeSubmitComment={beforeSubmitComment}
        />
        <ComposerSheet
          visible={composerOpen}
          defaultTopic={composeDefaultTopic}
          onClose={() => setComposerOpen(false)}
          onModerationRejected={() => setNotice("rejected")}
          onPublishFailed={() => setNotice("network")}
        />
        <RulesSheet
          visible={rulesVisible}
          onAccepted={() => {
            if (rulesAnswer.current) rulesAnswer.current.accepted = true;
            setRulesVisible(false);
          }}
          onClose={() => setRulesVisible(false)}
          onDismissed={() => {
            const answer = rulesAnswer.current;
            rulesAnswer.current = null;
            answer?.resolve(answer.accepted);
          }}
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

/** The hairline between two posts of the flat feed. */
function RowSeparator() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.rowSeparator} />;
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
    <PressableScale
      onPress={onPress}
      style={styles.iconButton}
      accessibilityRole="button"
      accessibilityLabel={t("inbox.title")}
    >
      <icons.bell size={22} color={theme.colors.textPrimary} weight="regular" />
      {unread > 0 && <View style={styles.bellDot} />}
    </PressableScale>
  );
}

/** Minimum touch target (Apple HIG / Material: 44pt / 48dp). */
const ICON_TARGET = 44;
/** The search bar that takes the topic tabs' slot. */
const CONTROL_HEIGHT = 40;
const FAB_SIZE = 56;

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background, overflow: "hidden" },
    top: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 1,
      backgroundColor: theme.colors.background,
    },
    controls: { paddingHorizontal: theme.spacing(5), paddingTop: theme.spacing(1) },
    // Icons sit flush with the content edge; each keeps a 44pt target.
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: ICON_TARGET,
      marginHorizontal: -(ICON_TARGET - 22) / 2,
    },
    // Both sides flex equally, so a centered title stays centered.
    headerSide: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.spacing(1) },
    headerSideRight: { justifyContent: "flex-end" },
    headerTitle: {
      flexShrink: 1,
      paddingHorizontal: (ICON_TARGET - 22) / 2,
      fontFamily: theme.fonts.serifBold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 20,
      color: theme.colors.textPrimary,
    },
    // Fits a square mark or a wordmark alike (`contentFit="contain"`).
    headerImage: { height: 32, width: 160 },
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
    switchRow: {
      // The border sits inside the height: without its share the tab row
      // overflows by a hairline and scrolls vertically.
      height: TABS_ROW_HEIGHT + StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.hairline,
    },
    searchSlot: { flex: 1, justifyContent: "center", paddingHorizontal: theme.spacing(5) },
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
      ...noFocusRing,
    },
    clearButton: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: theme.colors.textFaint,
      alignItems: "center",
      justifyContent: "center",
    },
    listWrap: { flex: 1, position: "relative" },
    rowSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.hairline },
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
    // Positioned under the top bar as it slides (`pillStyle`).
    newPill: { position: "absolute", alignSelf: "center", zIndex: 1 },
    newPillButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2),
      paddingHorizontal: theme.spacing(4.5),
      ...theme.shadow,
    },
    // Aligned with the rows' content edge, above the host's bottom bar
    // (`bottomChrome`) or the host's container edge.
    fab: { position: "absolute", right: theme.spacing(4) },
    fabButton: {
      width: FAB_SIZE,
      height: FAB_SIZE,
      borderRadius: FAB_SIZE / 2,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
      ...theme.shadow,
    },
    newPillText: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 13,
      color: theme.colors.textInverse,
    },
  });
}
