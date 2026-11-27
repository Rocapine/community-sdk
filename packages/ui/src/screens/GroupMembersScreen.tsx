// A group's members (members only), the creator first, with a search field. The
// creator and app admins can remove a member (never themselves, never an app admin
// unless they are one); a member removed here stays listed, greyed, with "Readmit"
// until the screen closes (the backend lists active members only). A plain screen: the
// host pads the top. Renders nothing when the groups module is off.
import {
  MessagingError,
  groupsSettings,
  useCommunityConfig,
  useGroup,
  useGroupMembers,
  useMyUid,
  useProfile,
  useReadmitMember,
  useRemoveMember,
  type GroupMember,
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
import { Avatar } from "../components/Avatar";
import { PressableScale } from "../components/PressableScale";
import { ScreenBackground } from "../components/ScreenBackground";
import { MessageMenu } from "../components/chat/MessageMenu";
import { canManage } from "../utils/groups";
import { noFocusRing } from "../utils/noFocusRing";
import { isQueryLoading } from "../utils/query";

const SEARCH_DEBOUNCE_MS = 300;

export type GroupMembersScreenProps = {
  groupId: string;
  onOpenProfile(userId: string): void;
  onBack(): void;
};

export function GroupMembersScreen(props: GroupMembersScreenProps) {
  const cfg = useCommunityConfig();
  if (!groupsSettings(cfg)) return null;
  return <Members {...props} />;
}

type Target = { member: GroupMember; name: string };

function Members({ groupId, onOpenProfile, onBack }: GroupMembersScreenProps) {
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const myUid = useMyUid();
  const meAdmin = !!useProfile(myUid).data?.admin;
  const group = useGroup(groupId).data;
  const manage = !!group && canManage(group, meAdmin);

  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);
  const members = useGroupMembers(groupId, query);

  const remove = useRemoveMember();
  const readmit = useReadmitMember();
  const [removed, setRemoved] = useState<GroupMember[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const active = members.data?.pages.flat() ?? [];
    const ids = new Set(active.map((m) => m.userId));
    return [...active, ...removed.filter((m) => !ids.has(m.userId))];
  }, [members.data, removed]);
  const removedIds = useMemo(() => new Set(removed.map((m) => m.userId)), [removed]);

  const fail = (e: unknown) => {
    setError(
      t(
        e instanceof MessagingError && e.code === "not_found"
          ? "chat.groupDeleted"
          : "groups.error.generic",
      ),
    );
  };
  const doRemove = (member: GroupMember) => {
    setError(null);
    setBusyId(member.userId);
    remove.mutate(
      { groupId, userId: member.userId },
      {
        onSuccess: () => setRemoved((r) => [...r, member]),
        onError: fail,
        onSettled: () => setBusyId(null),
      },
    );
  };
  const doReadmit = (member: GroupMember) => {
    setError(null);
    setBusyId(member.userId);
    readmit.mutate(
      { groupId, userId: member.userId },
      {
        onSuccess: () => setRemoved((r) => r.filter((m) => m.userId !== member.userId)),
        onError: fail,
        onSettled: () => setBusyId(null),
      },
    );
  };

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
          {t("groups.members.title")}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.searchField}>
        <icons.search size={16} color={theme.colors.textFaint} />
        <TextInput
          value={term}
          onChangeText={setTerm}
          returnKeyType="search"
          placeholder={t("groups.members.search")}
          placeholderTextColor={theme.colors.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={t("groups.members.search")}
          style={styles.searchInput}
        />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={rows}
        keyExtractor={(m) => m.userId}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => (
          <MemberRow
            member={item}
            me={myUid}
            meAdmin={meAdmin}
            manage={manage}
            removed={removedIds.has(item.userId)}
            busy={busyId === item.userId}
            onOpenProfile={onOpenProfile}
            onRemove={(name) => setConfirm({ member: item, name })}
            onReadmit={() => doReadmit(item)}
          />
        )}
        onEndReached={() => {
          if (members.hasNextPage && !members.isFetchingNextPage) void members.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          isQueryLoading(members) ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
          ) : (
            <Text style={styles.empty}>
              {t(members.isError ? "feed.unreachableRetry" : "groups.members.empty")}
            </Text>
          )
        }
        ListFooterComponent={
          members.isFetchingNextPage ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
          ) : null
        }
      />

      <MessageMenu
        visible={confirm !== null}
        title={confirm ? t("groups.members.removeConfirm", { name: confirm.name }) : undefined}
        actions={
          confirm
            ? [
                {
                  key: "remove",
                  label: t("groups.members.remove"),
                  destructive: true,
                  onPress: () => doRemove(confirm.member),
                },
              ]
            : []
        }
        onClose={() => setConfirm(null)}
      />
    </View>
  );
}

function MemberRow({
  member,
  me,
  meAdmin,
  manage,
  removed,
  busy,
  onOpenProfile,
  onRemove,
  onReadmit,
}: {
  member: GroupMember;
  me: string | null;
  meAdmin: boolean;
  manage: boolean;
  removed: boolean;
  busy: boolean;
  onOpenProfile(userId: string): void;
  onRemove(name: string): void;
  onReadmit(): void;
}) {
  const t = useT();
  const theme = useCommunityTheme();
  const styles = useThemedStyles(makeStyles);
  const profile = useProfile(member.userId).data;
  const name = profile?.name ?? "";
  // As remove_member allows: never myself, never an app admin unless I am one.
  const removable = manage && member.userId !== me && (meAdmin || !profile?.admin);
  const creator = member.role === "creator";

  return (
    <View style={[styles.row, removed && styles.removed]}>
      <Pressable
        onPress={() => onOpenProfile(member.userId)}
        style={styles.who}
        accessibilityRole="button"
        accessibilityLabel={creator ? `${name}, ${t("groups.members.creator")}` : name}
      >
        <Avatar
          userId={member.userId}
          name={name}
          url={profile?.avatarUrl ?? null}
          size={40}
          placement="member"
          admin={profile?.admin}
          handle={profile?.handle ?? null}
          badges={profile?.badges}
        />
        <View style={styles.whoText}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {creator && <Text style={styles.tag}>{t("groups.members.creator")}</Text>}
        </View>
      </Pressable>
      {busy ? (
        <ActivityIndicator color={theme.colors.accent} />
      ) : removed ? (
        <PressableScale onPress={onReadmit} style={styles.pill}>
          <Text style={styles.pillLabel}>{t("groups.members.readmit")}</Text>
        </PressableScale>
      ) : removable ? (
        <PressableScale
          onPress={() => onRemove(name)}
          style={styles.pill}
          accessibilityLabel={`${t("groups.members.remove")}, ${name}`}
        >
          <Text style={[styles.pillLabel, styles.danger]}>{t("groups.members.remove")}</Text>
        </PressableScale>
      ) : null}
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
    },
    headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    title: {
      flex: 1,
      textAlign: "center",
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textPrimary,
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
    loader: { marginVertical: theme.spacing(6) },
    empty: {
      ...theme.typography.bodySmall,
      color: theme.colors.textFaint,
      textAlign: "center",
      marginTop: theme.spacing(6),
      paddingHorizontal: theme.spacing(6),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2.5),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.hairline,
    },
    removed: { opacity: 0.5 },
    who: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.spacing(3) },
    whoText: { flex: 1, minWidth: 0, gap: 2 },
    name: {
      ...theme.typography.label,
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      color: theme.colors.textPrimary,
    },
    tag: { ...theme.typography.caption, color: theme.colors.accent },
    pill: {
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(1.5),
      paddingHorizontal: theme.spacing(3.5),
    },
    pillLabel: {
      ...theme.typography.meta,
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      color: theme.colors.textPrimary,
    },
    danger: { color: theme.colors.danger },
  });
}
