// A conversation, validated mockup "bubbles": a group (groups module) or a DM (dms
// module). The header: the group's picture, name, "● X online" when other members are,
// notifications bell; a DM's peer avatar, name and "● Online" (tap: their profile). The
// messages newest at the bottom in runs by author with a separator between days (names
// over bubbles in groups only), "X is typing…", and the composer. A double tap likes a
// message, a swipe right replies to it (native), a long press opens its menu.
// `mode: "preview"` reads the group without joining: a "Join" bar replaces the composer,
// and joining turns the screen into the member's chat in place. A member removed, or a
// group deleted, sees a line instead of the composer; so does a DM across a block.
//
// A DM request I received opens read-only (validated mockup B): the sender's context
// under the header (groups in common, member since) and a bar Accept / Decline / Block
// and report instead of the composer. Nothing tells the sender I read it: no read
// state, no typing. Accepting turns the screen live in place; declining or blocking
// closes it. With read receipts, "Seen" goes under my last message once the peer read it.
//
// The host pads the top (like every screen); the screen pads the bottom (safe area,
// keyboard). Renders nothing when no messaging module is on.
import {
  COMMUNITY_EVENTS,
  MessagingError,
  dmsSettings,
  emitEvent,
  groupsSettings,
  isOptimistic,
  messagingSettings,
  useAccountLinked,
  useAcceptRequest,
  useBlockAndReportRequest,
  useCommunityConfig,
  useConversations,
  useDeclineRequest,
  useDeleteMessage,
  useDmRequests,
  useEditMessage,
  useGroup,
  useGroupOnlineCounts,
  useIsOnline,
  useJoinGroup,
  useMarkConversationRead,
  useMessages,
  useMyUid,
  usePeerRead,
  useProfile,
  useRefreshGroupOnFocus,
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
import { GestureHandlerRootView } from "react-native-gesture-handler";
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
import { OnlineLabel } from "../components/OnlineLabel";
import { TypingLine } from "../components/chat/TypingLine";
import {
  canDeleteMessage,
  closedReason,
  conversationIdentity,
  dmState,
  findOrLoadMessage,
  groupByDay,
  groupClosed,
  localDay,
  msUntilNextDay,
  replyPreview,
  runFlags,
  screenErrorCode,
  seenMessageId,
  sendErrorKey,
  senderContext,
  type ChatAction,
} from "../utils/chat";
import { canCopy, copyText } from "../utils/clipboard";
import { groupErrorKey, needsAccount, onlineLabel } from "../utils/groups";
import { imagesSupported, pickImage } from "../utils/postImage";
import { isQueryLoading } from "../utils/query";

export type ConversationScreenProps = {
  conversationId: string;
  /** `"preview"`: read-only with a "Join" bar (a group the reader hasn't joined). */
  mode?: "member" | "preview";
  onOpenProfile(userId: string): void;
  /** Tapping a group's header (group details). A DM's header opens `onOpenProfile`. */
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

type Row = {
  key: string;
  message?: ChatMessage;
  day?: string;
  /** The message opens / closes its run (`runFlags`). */
  first?: boolean;
  last?: boolean;
};

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
  if (!messagingSettings(cfg)) return null;
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

  const conversations = useConversations();
  const conversation = conversations.data?.find((c) => c.id === conversationId);
  // The list holds my active conversations only: a request I received comes from my
  // pending requests. Once known, a DM stays that DM for the screen's life (an accept or
  // a decline refetches both lists, and it may sit in neither for a moment).
  const dmsOn = !!dmsSettings(cfg);
  const requests = useDmRequests();
  const request = requests.data?.find((r) => r.conversationId === conversationId);
  const loaded = !isQueryLoading(conversations) && !isQueryLoading(requests);
  const sticky = useRef<{ kind: "dm" | "group"; peerId: string | null } | null>(null);
  const identity = conversationIdentity({
    listed: conversation,
    request,
    sticky: sticky.current,
    dmsOn,
    groupsOn: !!groupsSettings(cfg),
    preview: mode === "preview",
    loaded,
  });
  if (identity.confirmed && identity.kind)
    sticky.current = { kind: identity.kind, peerId: identity.peerId };
  const { kind, peerId } = identity;
  const isDm = kind === "dm";
  const groupQuery = useGroup(kind === "group" ? conversationId : null);
  const group = groupQuery.data;
  const online =
    useGroupOnlineCounts(kind === "group" ? [conversationId] : [])[conversationId] ?? 0;

  const [joined, setJoined] = useState(false);
  // A loaded group decides: a member-mode screen of a group I'm out of (left,
  // readmitted, a stale list) offers Join.
  const member = joined || (group ? group.isMember : mode === "member");
  const [errorCode, setErrorCode] = useState<MessagingErrorCode | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const accountLinked = useAccountLinked();
  // A removal, a readmission or a join while the screen was away (groups/004 covers the
  // ones while it is open).
  useRefreshGroupOnFocus(kind === "group" ? conversationId : null, isFocused);
  // A failed action said "removed", the group now says I'm in again (readmitted, rejoined).
  useEffect(() => {
    if (group?.isMember)
      setErrorCode((c) => (c === "not_a_member" || c === "removed_from_group" ? null : c));
  }, [group?.isMember]);
  // A join made here no longer counts once I'm removed (a readmission then offers Join).
  useEffect(() => {
    if (group?.removed) setJoined(false);
  }, [group?.removed]);
  // ---- DM ----
  const peer = useProfile(isDm ? peerId : null).data;
  const peerOnline = useIsOnline(isDm ? peerId : null);
  // Accepted here: live at once, before the lists catch up.
  const [accepted, setAccepted] = useState(false);
  // Declined or blocked here: reads and the channel stop before the screen closes (the
  // channel was authorized once, at join).
  const [left, setLeft] = useState(false);
  const state = isDm
    ? dmState({ listed: conversation, pending: !!request, accepted, left, loaded, errorCode })
    : null;
  const requestMode = state === "request" || state === "left";
  // An unblock (dms/004) brings the peer back in the list: a send refused as blocked no
  // longer closes the composer.
  useEffect(() => {
    if (conversation?.peerId) setErrorCode((c) => (c === "blocked" ? null : c));
  }, [conversation?.peerId]);

  const closed =
    kind === "group"
      ? groupClosed(group, errorCode, identity.confirmed)
      : state === "blocked" || state === "unavailable"
        ? state
        : null;
  const active = member && !closed && kind !== null && (!isDm || state === "active");

  // Closed: no more reads nor Realtime. A blocked DM keeps both (the server filters the
  // blocked member's messages), so an unblock (dms/004's broadcast) reopens it live.
  const messages = useMessages(left || (closed && closed !== "blocked") ? null : conversationId);
  // A request leaves no read state.
  useMarkConversationRead(active ? conversationId : null, isFocused);
  // Previewers see who is typing too; only members type (the composer). A DM joins the
  // typing channel only while live: never from a request, nor across a block.
  const { typingUserIds, notifyTyping } = useTyping(
    kind === null || closed || (isDm && !active) ? null : conversationId,
  );
  const peerRead = usePeerRead(isDm && active ? conversationId : null);

  // Once per opening (the screen is keyed by conversation), once its kind is known.
  const opened = useRef(false);
  useEffect(() => {
    if (kind === null || opened.current) return;
    opened.current = true;
    emitEvent(cfg, COMMUNITY_EVENTS.conversationOpened, { conversationId, kind });
    if (mode === "preview")
      emitEvent(cfg, COMMUNITY_EVENTS.groupPreviewed, { groupId: conversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

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
  const acceptRequest = useAcceptRequest();
  const declineRequest = useDeclineRequest();
  const blockRequest = useBlockAndReportRequest();
  const [requestError, setRequestError] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const answering =
    acceptRequest.isPending || declineRequest.isPending || blockRequest.isPending || left;
  const leave = () => {
    setLeft(true);
    onBack();
  };
  const accept = () => {
    if (answering) return;
    setRequestError(null);
    acceptRequest.mutate(
      { conversationId },
      {
        // The draft a refused send left (both wrote first at once: mine became a request)
        // is still in `text`; the refusal's line goes.
        onSuccess: () => {
          setAccepted(true);
          setErrorCode(null);
        },
        onError: () => setRequestError(t("dms.request.error")),
      },
    );
  };
  const decline = () => {
    if (answering) return;
    setRequestError(null);
    declineRequest.mutate(
      { conversationId },
      { onSuccess: leave, onError: () => setRequestError(t("dms.request.error")) },
    );
  };

  const listRef = useRef<FlatList<Row>>(null);
  const fail = (action: ChatAction) => (e: unknown) => {
    const code = e instanceof MessagingError ? e.code : "unknown";
    // A DM's first message with `requireAccount` and no account of mine (or theirs); a
    // host without the callback gets the line.
    if (action === "send" && code === "account_required" && cfg.host.onAccountRequired)
      cfg.host.onAccountRequired("dm");
    else setErrorCode(screenErrorCode(action, code));
  };
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
          else if (closedReason(group, code)) fail("join")(e);
          else setJoinError(t(groupErrorKey(code)));
        },
      },
    );
  };

  const startReply = (m: ChatMessage) => {
    if (editing) setText("");
    setEditing(null);
    setReplyTo(m);
    inputRef.current?.focus();
  };
  const reply = useStable(startReply);
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
  // And at local midnight while the screen stays open (a timer per day).
  useEffect(() => {
    const timer = setTimeout(() => setToday(localDay(new Date())), msUntilNextDay(new Date()));
    return () => clearTimeout(timer);
  }, [today]);
  const rows = useMemo<Row[]>(
    () =>
      groupByDay(pages?.flat() ?? []).flatMap((g) => {
        const runs = runFlags(g.items);
        return [
          ...g.items.map((m, i) => ({ key: m.id, message: m, ...runs[i] })),
          // Inverted list: the day's separator comes after its oldest message.
          { key: `day-${g.day}`, day: g.day },
        ];
      }),
    [pages],
  );
  // "Seen" under my last message only (dm_peer_read may pass older hidden ones).
  const seenId = useMemo(
    () => (peerRead ? seenMessageId(pages?.flat() ?? [], myUid, peerRead, isOptimistic) : null),
    [pages, myUid, peerRead],
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
      if (item.day) return <DaySeparator day={item.day} today={today} />;
      const m = item.message!;
      const usable = !isOptimistic(m) && m.status !== "deleted" && m.status !== "hidden";
      const bubble = (
        <MessageBubble
          message={m}
          own={m.authorId === myUid}
          showName={kind === "group" && m.authorId !== myUid}
          first={!!item.first}
          last={!!item.last}
          translation={translations[m.id]}
          onShowOriginal={showOriginal}
          onMenu={usable ? openMenu : undefined}
          onToggleLike={usable && active ? like : undefined}
          onReply={usable && active ? reply : undefined}
          onOpenProfile={openProfile}
          onPressQuote={pressQuote}
          onOpenAttachment={onOpenAttachment ? openAttachment : undefined}
        />
      );
      if (m.id !== seenId) return bubble;
      return (
        <View>
          {bubble}
          <Text style={styles.seen}>{t("chat.seen")}</Text>
        </View>
      );
    },
    [myUid, kind, translations, active, today, !!onOpenAttachment, seenId, styles, t],
  );

  // ---- header ----
  const peerName = peer?.name ?? (closed === "blocked" ? t("dms.blockedMember") : "");
  const notify = conversation?.notify ?? false;
  // Other members online only (groups/007 leaves me out), and nothing at 0.
  const onlineText = group ? onlineLabel(online, t) : null;
  const errorText = errorCode && !closed ? t(sendErrorKey(errorCode)) : null;
  const canSend = (text.trim().length > 0 || (image !== null && !editing)) && !gating && !preparing;
  const banner = editing
    ? { title: t("chat.editing") }
    : replyTo
      ? {
          title: t("thread.replyingTo", { name: replyName ?? "" }),
          detail: replyPreview(replyTo, t),
        }
      : null;
  const bottomPad = keyboardHeight > 0 ? theme.spacing(2) : insets.bottom + theme.spacing(2);

  return (
    // The bubbles' gestures need a gesture root; the host may not have one.
    <GestureHandlerRootView style={[styles.root, { paddingBottom: keyboardHeight }]}>
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
        {isDm ? (
          <Pressable
            onPress={() => peerId && onOpenProfile(peerId)}
            disabled={!peerId}
            style={styles.headerInfo}
            accessibilityRole="button"
            accessibilityLabel={
              [peerName, peerOnline ? t("a11y.online") : null].filter(Boolean).join(", ") ||
              undefined
            }
          >
            <Avatar
              userId={peerId}
              name={peerName}
              url={peer?.avatarUrl ?? null}
              size={36}
              placement="dmHeader"
              admin={peer?.admin ?? false}
              handle={peer?.handle ?? null}
              badges={peer?.badges}
            />
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
                {peerName}
              </Text>
              {peerOnline && (
                <Text style={[styles.subtitle, { color: theme.colors.success }]}>
                  {`● ${t("a11y.online")}`}
                </Text>
              )}
            </View>
          </Pressable>
        ) : (
          <Pressable
            onPress={onOpenGroupDetails}
            disabled={!onOpenGroupDetails || !group}
            style={styles.headerInfo}
            accessibilityRole={onOpenGroupDetails ? "button" : undefined}
            accessibilityLabel={[group?.name, onlineText].filter(Boolean).join(", ") || undefined}
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
              <OnlineLabel count={group ? online : 0} style={styles.subtitle} />
            </View>
          </Pressable>
        )}
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
      {requestMode && request && (
        <Text style={styles.context}>{senderContext(request, cfg.host.getLocale(), t)}</Text>
      )}

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
            {t(
              closed === "blocked"
                ? "chat.blocked"
                : closed === "unavailable"
                  ? "chat.unavailable"
                  : closed === "removed"
                    ? "chat.removed"
                    : "chat.groupDeleted",
            )}
          </Text>
        ) : requestMode ? (
          <View style={styles.joinBar}>
            <Text style={styles.requestHint}>{t("dms.request.bar", { name: peerName })}</Text>
            {requestError && <Text style={styles.error}>{requestError}</Text>}
            <View style={styles.requestButtons}>
              <PressableScale
                onPress={accept}
                disabled={answering}
                haptic="medium"
                style={[styles.join, styles.requestButton, answering && styles.disabled]}
              >
                <Text style={styles.joinLabel}>{t("dms.request.accept")}</Text>
              </PressableScale>
              <PressableScale
                onPress={decline}
                disabled={answering}
                style={[styles.decline, styles.requestButton, answering && styles.disabled]}
              >
                <Text style={styles.declineLabel}>{t("dms.request.decline")}</Text>
              </PressableScale>
            </View>
            <Pressable
              onPress={() => setBlockOpen(true)}
              disabled={answering}
              style={styles.blockButton}
              accessibilityRole="button"
            >
              <Text style={styles.blockLabel}>{t("dms.request.block")}</Text>
            </Pressable>
          </View>
        ) : kind === null || state === "loading" ? null : !member ? (
          <>
            <TypingLine userIds={typingUserIds} />
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
          </>
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
      {requestMode && peerId && (
        <ReportSheet
          visible={blockOpen}
          target={{ kind: "message", id: conversationId, authorId: peerId }}
          onClose={() => setBlockOpen(false)}
          onSubmitReason={async (reason) => {
            await blockRequest.mutateAsync({ conversationId, reason });
            leave();
          }}
        />
      )}
    </GestureHandlerRootView>
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
    context: {
      ...theme.typography.caption,
      color: theme.colors.textMuted,
      textAlign: "center",
      paddingHorizontal: theme.spacing(6),
      paddingVertical: theme.spacing(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.hairline,
    },
    seen: {
      ...theme.typography.caption,
      color: theme.colors.textFaint,
      textAlign: "right",
      paddingHorizontal: theme.spacing(4),
      marginTop: theme.spacing(0.5),
    },
    requestHint: {
      ...theme.typography.meta,
      color: theme.colors.textMuted,
      textAlign: "center",
    },
    requestButtons: { flexDirection: "row", gap: theme.spacing(2) },
    requestButton: { flex: 1 },
    decline: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(3.5),
      alignItems: "center",
    },
    declineLabel: {
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textPrimary,
    },
    blockButton: { alignSelf: "center", minHeight: 44, justifyContent: "center" },
    blockLabel: { ...theme.typography.label, color: theme.colors.danger },
    joinLabel: {
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textInverse,
    },
  });
}
