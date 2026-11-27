// A group conversation (groups module; DMs later), validated mockup "bubbles": the
// group's header (picture, name, "N members · X online", notifications bell), the
// messages newest at the bottom with a separator between days, "X is typing…", and
// the composer. `mode: "preview"` reads the group without joining: a "Join" bar
// replaces the composer, and joining turns the screen into the member's chat in
// place. A member removed, or a group deleted, sees a line instead of the composer.
//
// The host pads the top (like every screen); the screen pads the bottom (safe area,
// keyboard). Renders nothing when the groups module is off.
import {
  COMMUNITY_EVENTS,
  MessagingError,
  emitEvent,
  groupsSettings,
  isOptimistic,
  messagingSettings,
  useAccountLinked,
  useCommunityConfig,
  useConversations,
  useDeleteMessage,
  useEditMessage,
  useGroup,
  useGroupOnlineCounts,
  useJoinGroup,
  useMarkConversationRead,
  useMessages,
  useMyUid,
  useProfile,
  useSendMessage,
  useSetGroupNotify,
  useToggleMessageLike,
  useTranslateMessage,
  useTyping,
  type ChatMessage,
  type LocalImage,
  type MessagingErrorCode,
  type PostAttachment,
} from "@rocapine/community-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { Avatar } from "../components/Avatar";
import { useKeyboardHeight } from "../components/ComposerSheet";
import { GroupReviewNotice } from "../components/GroupFormSheet";
import { GroupLinkContext, type GroupLink } from "../components/GroupAttachment";
import { ImageViewerHost } from "../components/ImageViewer";
import { PressableScale, haptic } from "../components/PressableScale";
import { ReportSheet, type ReportTarget } from "../components/ReportSheet";
import { ScreenBackground } from "../components/ScreenBackground";
import { ChatComposer } from "../components/chat/ChatComposer";
import { DaySeparator } from "../components/chat/DaySeparator";
import { MessageBubble } from "../components/chat/MessageBubble";
import { MessageMenu, type MessageMenuAction } from "../components/chat/MessageMenu";
import { TypingLine } from "../components/chat/TypingLine";
import {
  canDeleteMessage,
  closedReason,
  findOrLoadMessage,
  groupByDay,
  localDay,
  screenErrorCode,
  sendErrorKey,
  type ChatAction,
} from "../utils/chat";
import { canCopy, copyText } from "../utils/clipboard";
import { groupErrorKey, needsAccount } from "../utils/groups";
import { imagesSupported, pickImage } from "../utils/postImage";
import { isQueryLoading } from "../utils/query";

export type ConversationScreenProps = {
  conversationId: string;
  /** `"preview"`: read-only with a "Join" bar (a group the reader hasn't joined). */
  mode?: "member" | "preview";
  onOpenProfile(userId: string): void;
  /** Tapping the header (group details). */
  onOpenGroupDetails?(): void;
  /** Opens an attached item; defaults to the provider's `onOpenAttachment`. */
  onOpenAttachment?(attachment: PostAttachment): void;
  /** Opens a group from a group card in a message (`preview`: I'm not a member). Absent
   * ⇒ the card only joins. */
  onOpenGroup?(groupId: string, preview: boolean): void;
  onBack(): void;
  /** Host gate run before sending (same contract as the feed's `beforeCompose`):
   * resolve false to cancel. */
  beforeSend?: () => Promise<boolean>;
  /** Host gate run before joining from the preview, after the SDK's own account check
   * (same contract; with `requireAccount: "feed"`, pass the feed's `beforeCompose`). */
  beforeJoinGroup?: () => Promise<boolean>;
  /** The screen has the navigator's focus (`useIsFocused()`): the conversation is
   * marked read only while it does. Default true. */
  isFocused?: boolean;
};

type Row = { key: string; message?: ChatMessage; day?: string };

/** A callback whose identity never changes but that always runs the latest closure,
 * so memoized rows don't re-render on each keystroke. */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

export function ConversationScreen(props: ConversationScreenProps) {
  const cfg = useCommunityConfig();
  const { onOpenGroup, beforeJoinGroup } = props;
  // Stable against inline host callbacks (see the feed's).
  const latest = useRef({ onOpenGroup, beforeJoinGroup });
  latest.current = { onOpenGroup, beforeJoinGroup };
  const canOpen = !!onOpenGroup;
  const hasGate = !!beforeJoinGroup;
  const groupLink = useMemo<GroupLink | null>(
    () =>
      canOpen
        ? {
            openGroup: (groupId, preview) => latest.current.onOpenGroup?.(groupId, preview),
            beforeJoinGroup: hasGate ? () => latest.current.beforeJoinGroup!() : undefined,
          }
        : null,
    [canOpen, hasGate],
  );
  if (!groupsSettings(cfg)) return null;
  return (
    <GroupLinkContext.Provider value={groupLink}>
      <ImageViewerHost>
        <Conversation key={props.conversationId} {...props} />
      </ImageViewerHost>
    </GroupLinkContext.Provider>
  );
}

function Conversation({
  conversationId,
  mode = "member",
  onOpenProfile,
  onOpenGroupDetails,
  onOpenAttachment,
  onBack,
  beforeSend,
  beforeJoinGroup,
  isFocused = true,
}: ConversationScreenProps) {
  const cfg = useCommunityConfig();
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(insets.bottom);
  const settings = messagingSettings(cfg)!;
  const myUid = useMyUid();
  const me = useProfile(myUid).data;

  const conversation = useConversations().data?.find((c) => c.id === conversationId);
  const kind = conversation?.kind ?? "group";
  const groupQuery = useGroup(kind === "group" ? conversationId : null);
  const group = groupQuery.data;
  const online =
    useGroupOnlineCounts(kind === "group" ? [conversationId] : [])[conversationId] ?? 0;

  const [joined, setJoined] = useState(false);
  const member = mode === "member" || joined || !!group?.isMember;
  const [errorCode, setErrorCode] = useState<MessagingErrorCode | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const accountLinked = useAccountLinked();
  const closed = closedReason(group, errorCode, mode === "member");
  const active = member && !closed;

  // Closed: no more reads nor Realtime.
  const messages = useMessages(closed ? null : conversationId);
  useMarkConversationRead(active ? conversationId : null, isFocused);
  // Previewers see who is typing too; only members type (the composer).
  const { typingUserIds, notifyTyping } = useTyping(closed ? null : conversationId);

  useEffect(() => {
    emitEvent(cfg, COMMUNITY_EVENTS.conversationOpened, { conversationId, kind });
    if (mode === "preview")
      emitEvent(cfg, COMMUNITY_EVENTS.groupPreviewed, { groupId: conversationId });
    // Once per opening (the screen is keyed by conversation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- composer ----
  const inputRef = useRef<TextInputInstance>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<LocalImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [gating, setGating] = useState(false);
  const latest = useRef({ text, image });
  latest.current = { text, image };
  const [imagesOn] = useState(imagesSupported);
  const replyName = useProfile(replyTo?.authorId ?? null).data?.name;

  const sendMessage = useSendMessage();
  const editMessage = useEditMessage();
  const deleteMessage = useDeleteMessage();
  const toggleLike = useToggleMessageLike();
  const translate = useTranslateMessage();
  const join = useJoinGroup();
  const setNotify = useSetGroupNotify();

  const listRef = useRef<FlatList<Row>>(null);
  const fail = (action: ChatAction) => (e: unknown) =>
    setErrorCode(screenErrorCode(action, e instanceof MessagingError ? e.code : "unknown"));
  const gate = async (hostGate = beforeSend) => {
    if (!hostGate) return true;
    setGating(true);
    try {
      return await hostGate();
    } catch {
      return false;
    } finally {
      setGating(false);
    }
  };

  const changeText = (value: string) => {
    setText(value);
    setErrorCode(null);
    if (value.trim() && !editing) notifyTyping();
  };

  const pick = async () => {
    if (preparing) return;
    setPreparing(true);
    try {
      const picked = await pickImage();
      if (picked) setImage(picked);
    } finally {
      setPreparing(false);
    }
  };

  const submit = async () => {
    const body = text.trim();
    if (gating || preparing) return;
    if (editing) {
      if (!body) return;
      const target = editing;
      setEditing(null);
      setText("");
      editMessage.mutate(
        { conversationId, messageId: target.id, body },
        {
          onError: (e) => {
            fail("edit")(e);
            if (!latest.current.text.trim()) {
              setEditing(target);
              setText(body);
            }
          },
        },
      );
      return;
    }
    if (!body && !image) return;
    if (!(await gate())) return;
    const sentImage = image;
    const sentReply = replyTo;
    setText("");
    setImage(null);
    setReplyTo(null);
    setErrorCode(null);
    haptic("light");
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    sendMessage.mutate(
      {
        conversationId,
        ...(body ? { body } : {}),
        ...(sentReply ? { replyToId: sentReply.id } : {}),
        ...(sentImage ? { imageUri: sentImage.url } : {}),
      },
      {
        // The draft comes back, unless a new one was started meanwhile.
        onError: (e) => {
          fail("send")(e);
          if (latest.current.text.trim() || latest.current.image) return;
          setText(body);
          setImage(sentImage);
          setReplyTo(sentReply);
        },
      },
    );
  };

  const joinNow = async () => {
    if (join.isPending || gating) return;
    setJoinError(null);
    if (needsAccount(groupsSettings(cfg)!.requireAccount === true, accountLinked))
      return cfg.host.onAccountRequired?.("joinGroup");
    if (!(await gate(beforeJoinGroup))) return;
    join.mutate(
      { groupId: conversationId, source: "preview" },
      {
        onSuccess: () => setJoined(true),
        onError: (e) => {
          const code = e instanceof MessagingError ? e.code : "unknown";
          if (code === "account_required") cfg.host.onAccountRequired?.("joinGroup");
          // A removed member or a deleted group closes the screen; any other failure
          // (full, limit reached…) says why on the join bar.
          else if (closedReason(group, code, false)) fail("join")(e);
          else setJoinError(t(groupErrorKey(code)));
        },
      },
    );
  };

  const startReply = (m: ChatMessage) => {
    setEditing(null);
    setReplyTo(m);
    inputRef.current?.focus();
  };
  const startEdit = (m: ChatMessage) => {
    setReplyTo(null);
    setImage(null);
    setEditing(m);
    setText(m.body ?? "");
    inputRef.current?.focus();
  };
  const cancelBanner = () => {
    if (editing) setText("");
    setEditing(null);
    setReplyTo(null);
  };
  const like = useStable((m: ChatMessage) => {
    haptic("light");
    toggleLike.mutate(
      { conversationId, messageId: m.id, liked: !m.likedByMe },
      { onError: fail("like") },
    );
  });

  // ---- menu ----
  const [menuFor, setMenuFor] = useState<{ m: ChatMessage; authorAdmin: boolean } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pendingReport = useRef<ReportTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [copyOn] = useState(canCopy);
  const translateOn = settings.translation === "onDemand" && !!cfg.modules.translation;
  const creator = conversation?.role === "creator" || !!group?.isCreator;

  const menuActions = (m: ChatMessage, authorAdmin: boolean): MessageMenuAction[] => {
    const own = m.authorId === myUid;
    const actions: MessageMenuAction[] = [];
    if (active) {
      actions.push({
        key: "like",
        label: t(m.likedByMe ? "chat.menu.unlike" : "chat.menu.like"),
        onPress: () => like(m),
      });
      actions.push({ key: "reply", label: t("chat.menu.reply"), onPress: () => startReply(m) });
    }
    if (copyOn && m.body)
      actions.push({ key: "copy", label: t("chat.menu.copy"), onPress: () => copyText(m.body!) });
    if (translateOn && m.body && !own && translations[m.id] === undefined)
      actions.push({
        key: "translate",
        label: t("chat.menu.translate"),
        onPress: () =>
          translate.mutate(
            { conversationId, messageId: m.id },
            {
              onSuccess: (body) => setTranslations((p) => ({ ...p, [m.id]: body })),
              onError: fail("translate"),
            },
          ),
      });
    if (active && own && m.body && m.status === "visible")
      actions.push({ key: "edit", label: t("chat.menu.edit"), onPress: () => startEdit(m) });
    if (active && canDeleteMessage({ own, meAdmin: !!me?.admin, creator, authorAdmin }))
      actions.push({
        key: "delete",
        label: t("chat.menu.delete"),
        destructive: true,
        confirm: t("chat.deleteTitle"),
        onPress: () =>
          deleteMessage.mutate({ conversationId, messageId: m.id }, { onError: fail("delete") }),
      });
    if (!own)
      actions.push({
        key: "report",
        label: t("chat.menu.report"),
        destructive: true,
        onPress: () => {
          pendingReport.current = { kind: "message", id: m.id, authorId: m.authorId };
        },
      });
    return actions;
  };
  const openMenu = useStable((m: ChatMessage, authorAdmin: boolean) => {
    if (menuActions(m, authorAdmin).length === 0) return;
    setMenuFor({ m, authorAdmin });
    setMenuOpen(true);
  });

  // ---- list ----
  const pages = messages.data?.pages;
  // "Today" / "Yesterday" move at midnight: re-read the day on focus and on return
  // to the foreground.
  const [today, setToday] = useState(() => localDay(new Date()));
  useEffect(() => {
    const refresh = () => setToday(localDay(new Date()));
    refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [isFocused]);
  const rows = useMemo<Row[]>(
    () =>
      groupByDay(pages?.flat() ?? [], Date.now()).flatMap((g) => [
        ...g.items.map((m) => ({ key: m.id, message: m })),
        // Inverted list: the day's separator comes after its oldest message.
        { key: `day-${g.day}`, day: g.day },
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `today` refreshes the labels
    [pages, today],
  );
  const loadOlder = () => {
    if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
  };

  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const jump = useStable(async (id: string) => {
    let more = messages.hasNextPage;
    const found = await findOrLoadMessage(id, messages.data?.pages ?? [], async () => {
      if (!more) return null;
      const r = await messages.fetchNextPage();
      more = r.hasNextPage;
      return r.data?.pages ?? null;
    });
    if (found !== null) setJumpTo(id);
  });
  useEffect(() => {
    if (!jumpTo) return;
    const index = rows.findIndex((r) => r.message?.id === jumpTo);
    if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.5 });
    setJumpTo(null);
  }, [jumpTo, rows]);

  const showOriginal = useStable((id: string) =>
    setTranslations(({ [id]: _gone, ...rest }) => rest),
  );
  const pressQuote = useStable((id: string) => void jump(id));
  const openProfile = useStable(onOpenProfile);
  const openAttachment = useStable((a: PostAttachment) => onOpenAttachment?.(a));
  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.day) return <DaySeparator day={item.day} />;
      const m = item.message!;
      const usable = !isOptimistic(m) && m.status !== "deleted" && m.status !== "hidden";
      return (
        <MessageBubble
          message={m}
          own={m.authorId === myUid}
          showName={kind === "group" && m.authorId !== myUid}
          translation={translations[m.id]}
          onShowOriginal={showOriginal}
          onMenu={usable ? openMenu : undefined}
          onToggleLike={usable && active ? like : undefined}
          onOpenProfile={openProfile}
          onPressQuote={pressQuote}
          onOpenAttachment={onOpenAttachment ? openAttachment : undefined}
        />
      );
    },
    [myUid, kind, translations, active, !!onOpenAttachment],
  );

  // ---- header ----
  const notify = conversation?.notify ?? false;
  const subtitle = group
    ? [
        t("chat.members", { count: group.memberCount }),
        ...(online > 0 ? [t("chat.online", { count: online })] : []),
      ].join(" · ")
    : null;
  const errorText = errorCode && !closed ? t(sendErrorKey(errorCode)) : null;
  const canSend = (text.trim().length > 0 || (image !== null && !editing)) && !gating && !preparing;
  const banner = editing
    ? t("chat.editing")
    : replyTo
      ? t("thread.replyingTo", { name: replyName ?? "" })
      : null;
  const bottomPad = keyboardHeight > 0 ? theme.spacing(2) : insets.bottom + theme.spacing(2);

  return (
    <View style={[styles.root, { paddingBottom: keyboardHeight }]}>
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
        <Pressable
          onPress={onOpenGroupDetails}
          disabled={!onOpenGroupDetails || !group}
          style={styles.headerInfo}
          accessibilityRole={onOpenGroupDetails ? "button" : undefined}
        >
          {group && (
            <Avatar
              userId={null}
              name={group.name}
              url={group.imageUrl}
              size={36}
              placement="group"
            />
          )}
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {group?.name ?? ""}
            </Text>
            {subtitle && (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        </Pressable>
        {active && kind === "group" && (
          <Pressable
            onPress={() => {
              haptic("selection");
              setNotify.mutate(
                { groupId: conversationId, notify: !notify },
                { onError: fail("notify") },
              );
            }}
            style={styles.headerButton}
            accessibilityRole="switch"
            accessibilityLabel={t("chat.notify")}
            accessibilityState={{ checked: notify }}
          >
            <icons.bell
              size={20}
              color={notify ? theme.colors.accent : theme.colors.textMuted}
              weight={notify ? "fill" : "regular"}
            />
          </Pressable>
        )}
      </View>

      <GroupReviewNotice group={group} />

      {isQueryLoading(messages) ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={renderRow}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            messages.isFetchingNextPage ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.olderLoader} />
            ) : null
          }
          onScrollToIndexFailed={({
            index,
            averageItemLength,
          }: {
            index: number;
            averageItemLength: number;
          }) => {
            listRef.current?.scrollToOffset({ offset: index * averageItemLength });
            setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5 }), 250);
          }}
        />
      )}

      <View style={{ paddingBottom: bottomPad }}>
        {closed ? (
          <Text style={styles.closed}>
            {t(closed === "removed" ? "chat.removed" : "chat.groupDeleted")}
          </Text>
        ) : !member ? (
          <View style={styles.joinBar}>
            {joinError && <Text style={styles.error}>{joinError}</Text>}
            <PressableScale
              onPress={() => void joinNow()}
              disabled={join.isPending || gating}
              haptic="medium"
              style={[styles.join, (join.isPending || gating) && styles.disabled]}
            >
              <Text style={styles.joinLabel}>{t("chat.join")}</Text>
            </PressableScale>
          </View>
        ) : (
          <>
            <TypingLine userIds={typingUserIds.filter((id) => id !== myUid)} />
            <ChatComposer
              inputRef={inputRef}
              text={text}
              onChangeText={changeText}
              maxLength={settings.maxLength}
              image={image}
              preparing={preparing}
              onPickImage={imagesOn && !editing ? () => void pick() : undefined}
              onRemoveImage={() => setImage(null)}
              banner={banner}
              onCancelBanner={cancelBanner}
              error={errorText}
              canSend={canSend}
              onSend={() => void submit()}
            />
          </>
        )}
      </View>

      <MessageMenu
        visible={menuOpen}
        actions={menuFor ? menuActions(menuFor.m, menuFor.authorAdmin) : []}
        onClose={() => setMenuOpen(false)}
        onDismissed={() => {
          // A sheet opens only once the menu's Modal is gone (iOS).
          if (pendingReport.current) setReportTarget(pendingReport.current);
          pendingReport.current = null;
        }}
      />
      <ReportSheet
        visible={reportTarget !== null}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
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
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.hairline,
    },
    headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    headerInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.spacing(2.5) },
    headerText: { flex: 1 },
    title: {
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textPrimary,
    },
    subtitle: { ...theme.typography.caption, color: theme.colors.textMuted },
    loader: { flex: 1 },
    list: { flex: 1 },
    listContent: { paddingVertical: theme.spacing(2) },
    olderLoader: { marginVertical: theme.spacing(3) },
    closed: {
      ...theme.typography.meta,
      color: theme.colors.textMuted,
      textAlign: "center",
      paddingHorizontal: theme.spacing(6),
      paddingTop: theme.spacing(3),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.hairline,
    },
    joinBar: {
      paddingHorizontal: theme.spacing(4),
      paddingTop: theme.spacing(3),
      gap: theme.spacing(2),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.hairline,
    },
    error: { ...theme.typography.caption, color: theme.colors.danger, textAlign: "center" },
    join: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(3.5),
      alignItems: "center",
    },
    disabled: { opacity: 0.5 },
    joinLabel: {
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textInverse,
    },
  });
}
