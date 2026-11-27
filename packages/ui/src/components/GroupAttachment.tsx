// The built-in "join the group" attachment (`{ type: "group", id }`), drawn unless the
// host's `renderAttachment` handles it. Validated mockup A ("card", in a post): the
// group's picture, name and "N members · X online", two lines of description and a
// full-width Join / Open button; B ("banner", `groups.shareCardLayout`): the same under a
// banner; C ("compact", in a message bubble): one line, no description. A deleted group
// shows "This group no longer exists".
//
// Tapping the card opens the group (a read-only preview when I'm not a member, or a join
// when previews are off); the button joins, then opens it. Where to open it comes from
// `GroupLinkContext` (the feed's `onOpenMessages`, the chat's `onOpenGroup`): without
// one, the card only joins.
import {
  MessagingError,
  groupsSettings,
  useAccountLinked,
  useCommunityConfig,
  useGroup,
  useGroupOnlineCounts,
  useJoinGroup,
} from "@rocapine/community-core";
import { Image } from "expo-image";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { AttachmentVariant } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import {
  exploreRowAction,
  guardedJoin,
  exploreRowTap,
  groupErrorKey,
  needsAccount,
  onlineLabel,
} from "../utils/groups";
import { ModalHandoffContext } from "../utils/modalHandoff";
import { Avatar } from "./Avatar";
import { PressableScale } from "./PressableScale";

/** Where a group card (or the feed's Groups home) opens a group. */
export type GroupLink = {
  /** Its chat, or a read-only preview (`preview`) when I'm not a member. */
  openGroup(groupId: string, preview: boolean): void;
  /** Host gate before joining (same contract as `ExploreGroupsScreen`'s). */
  beforeJoinGroup?: () => Promise<boolean>;
};

export const GroupLinkContext = createContext<GroupLink | null>(null);

/** Joining from Explore, a card or the Groups home, in `guardedJoin`'s order; a
 * failure is a line of copy (an Alert never shows on web). */
export function useGuardedJoin(
  source: "share" | "explore" | "preview",
  beforeJoinGroup?: () => Promise<boolean>,
) {
  const cfg = useCommunityConfig();
  const t = useT();
  const linked = useAccountLinked();
  const mutation = useJoinGroup();
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const join = async (groupId: string, onJoined: () => void) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setJoiningId(groupId);
    const done = () => {
      busy.current = false;
      setJoiningId(null);
    };
    const result = await guardedJoin({
      accountMissing: needsAccount(groupsSettings(cfg)?.requireAccount === true, linked),
      onAccountRequired: () => cfg.host.onAccountRequired?.("joinGroup"),
      gate: beforeJoinGroup,
      join: () =>
        mutation.mutate(
          { groupId, source },
          {
            onSuccess: onJoined,
            onError: (e) => {
              const code = e instanceof MessagingError ? e.code : "unknown";
              if (code === "account_required") cfg.host.onAccountRequired?.("joinGroup");
              else setError(t(groupErrorKey(code)));
            },
            onSettled: done,
          },
        ),
    });
    if (result !== "joined") done();
  };
  return { joiningId, error, join };
}

export function GroupAttachment({
  groupId,
  variant,
  interactive,
}: {
  groupId: string;
  variant: AttachmentVariant;
  /** False in the composer: a preview of the card, nothing to tap. */
  interactive: boolean;
}) {
  const cfg = useCommunityConfig();
  const settings = groupsSettings(cfg);
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const link = useContext(GroupLinkContext);
  const presentModal = useContext(ModalHandoffContext);
  const query = useGroup(groupId);
  const online = useGroupOnlineCounts(useMemo(() => [groupId], [groupId]))[groupId] ?? 0;
  const { joiningId, error, join } = useGuardedJoin("share", link?.beforeJoinGroup);
  const compact = variant === "compact";

  const group = query.data;
  if (group === null)
    return (
      <View style={styles.gone}>
        <icons.groups size={14} color={theme.colors.textFaint} />
        <Text style={styles.goneText}>{t("groups.card.gone")}</Text>
      </View>
    );
  // Loading (or unreachable): the card's frame, so the post doesn't jump.
  if (!group || !settings)
    return (
      <View style={[styles.frame, compact ? styles.placeholderCompact : styles.placeholder]} />
    );

  // Inside the thread sheet, the sheet closes first.
  const open = (preview: boolean) => {
    if (link) presentModal(() => link.openGroup(group.id, preview));
  };
  const action = exploreRowAction(group);
  const press = () => (action === "open" ? open(false) : void join(group.id, () => open(false)));
  const tap = () => {
    const to = exploreRowTap(group, settings.preview);
    if (to === "join") void join(group.id, () => open(false));
    else open(to === "preview");
  };
  const tappable = interactive && !!link;
  // Without a place to open it, a member's card has no button.
  const showButton = !interactive || action === "join" || !!link;
  const busy = joiningId === group.id;

  const members = t("chat.members", { count: group.memberCount });
  const on = onlineLabel(online, t);
  const stats = (
    <Text style={styles.stats} numberOfLines={1}>
      {members}
      {on && (
        <>
          {" · "}
          <Text style={styles.online}>{on}</Text>
        </>
      )}
    </Text>
  );
  const label = t(action === "open" ? "groups.open" : compact ? "chat.join" : "groups.card.join");
  const button = showButton && (
    <PressableScale
      onPress={press}
      disabled={!interactive || busy}
      // 32pt (38pt wide) buttons: the slop takes the target to 44pt.
      hitSlop={compact ? 6 : 3}
      haptic={action === "join" ? "medium" : "selection"}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${group.name}`}
      style={[styles.button, !compact && styles.buttonWide, action === "open" && styles.ghost]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.colors.textInverse} />
      ) : (
        <Text style={[styles.buttonLabel, action === "open" && styles.ghostLabel]}>{label}</Text>
      )}
    </PressableScale>
  );
  const a11y = [group.name, members, on].filter(Boolean).join(", ");
  const name = (
    <Text style={styles.name} numberOfLines={1}>
      {group.name}
    </Text>
  );
  const description = !!group.description && (
    <Text style={styles.description} numberOfLines={2}>
      {group.description}
    </Text>
  );
  const errorLine = error && (
    <Text style={styles.error} accessibilityRole="alert">
      {error}
    </Text>
  );

  // The body and the button are siblings, never one pressable inside another (screen
  // readers reach both; the web gets no button inside a button).
  const body = (children: ReactNode, style?: StyleProp<ViewStyle>) => (
    <Pressable
      onPress={tap}
      disabled={!tappable}
      style={({ pressed }) => [style, pressed && styles.pressed]}
      accessibilityRole={tappable ? "button" : undefined}
      accessibilityLabel={a11y}
    >
      {children}
    </Pressable>
  );

  if (compact)
    return (
      <View>
        <View style={[styles.frame, styles.compact]}>
          {body(
            <>
              <Avatar
                userId={null}
                name={group.name}
                url={group.imageUrl}
                size={36}
                placement="group"
              />
              <View style={styles.flex}>
                {name}
                {stats}
              </View>
            </>,
            styles.compactMain,
          )}
          {button}
        </View>
        {errorLine}
      </View>
    );

  if (variant === "banner")
    return (
      <View>
        <View style={[styles.frame, styles.clip]}>
          {body(
            <>
              <View style={styles.banner}>
                {!!group.imageUrl && (
                  <Image
                    source={{ uri: group.imageUrl }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                )}
                <View style={styles.bannerAvatar}>
                  <Avatar
                    userId={null}
                    name={group.name}
                    url={group.imageUrl}
                    size={40}
                    placement="group"
                  />
                </View>
              </View>
              <View style={styles.bannerBody}>
                {name}
                {stats}
                {description}
              </View>
            </>,
          )}
          <View style={styles.footer}>{button}</View>
        </View>
        {errorLine}
      </View>
    );

  return (
    <View>
      <View style={[styles.frame, styles.card]}>
        {body(
          <>
            <View style={styles.head}>
              <Avatar
                userId={null}
                name={group.name}
                url={group.imageUrl}
                size={44}
                placement="group"
              />
              <View style={styles.flex}>
                {name}
                {stats}
              </View>
            </View>
            {description}
          </>,
        )}
        {button}
      </View>
      {errorLine}
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    frame: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    clip: { overflow: "hidden" },
    pressed: { opacity: 0.7 },
    placeholder: { height: 150 },
    placeholderCompact: { height: 56, minWidth: 220 },
    card: { padding: theme.spacing(3), gap: theme.spacing(2.5) },
    head: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3) },
    name: {
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textPrimary,
    },
    stats: { ...theme.typography.caption, color: theme.colors.textFaint, marginTop: 2 },
    online: { color: theme.colors.success },
    description: {
      ...theme.typography.meta,
      color: theme.colors.textSecondary,
      marginTop: theme.spacing(2),
    },
    banner: {
      height: 72,
      backgroundColor: theme.colors.accentSoft,
      justifyContent: "flex-end",
      padding: theme.spacing(2.5),
    },
    bannerAvatar: {
      alignSelf: "flex-start",
      borderWidth: 2,
      borderColor: theme.colors.surface,
      borderRadius: theme.radius.sm + 2,
      overflow: "hidden",
    },
    bannerBody: { paddingHorizontal: theme.spacing(3), paddingTop: theme.spacing(2.5) },
    footer: { padding: theme.spacing(3), paddingTop: theme.spacing(2.5) },
    compact: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2.5),
      minWidth: 220,
      paddingVertical: theme.spacing(2),
      paddingHorizontal: theme.spacing(2.5),
    },
    compactMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.spacing(2.5) },
    button: {
      minWidth: 64,
      minHeight: 32,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing(3.5),
    },
    buttonWide: { alignSelf: "stretch", minHeight: 38 },
    ghost: { backgroundColor: theme.colors.surfaceMuted },
    buttonLabel: {
      ...theme.typography.meta,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textInverse,
    },
    ghostLabel: { color: theme.colors.textPrimary },
    gone: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing(1.5),
      padding: theme.spacing(2.5),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.colors.borderStrong,
    },
    goneText: { ...theme.typography.meta, color: theme.colors.textFaint },
    error: {
      ...theme.typography.caption,
      color: theme.colors.danger,
      marginTop: theme.spacing(1.5),
    },
  });
}
