// A group's members (members only), the creator first, with a search field. Whoever
// manages the group (its active creator, an app admin) can remove a member (never
// themselves, never an app admin unless they are one), and sees a "Removed" section
// (group_removals) with Readmit, filtered by the same search. A plain screen: the host
// pads the top. Renders nothing when the groups module is off.
import {
  MessagingError,
  groupsSettings,
  useCommunityConfig,
  useGroup,
  useGroupMembers,
  useGroupRemovals,
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
type Row = { key: string; member?: GroupMember; removed?: boolean; section?: boolean };

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
  const removals = useGroupRemovals(groupId, query, manage);

  const remove = useRemoveMember();
  const readmit = useReadmitMember();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const active: Row[] = (members.data?.pages.flat() ?? []).map((m) => ({
      key: m.userId,
      member: m,
    }));
    const removed: Row[] = (removals.data ?? []).map((r) => ({
      key: `removed-${r.userId}`,
      member: { userId: r.userId, role: "member", joinedAt: r.removedAt },
      removed: true,
    }));
    return removed.length
      ? [...active, { key: "removed-section", section: true }, ...removed]
      : active;
  }, [members.data, removals.data]);

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
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item }) =>
          item.section ? (
            <Text style={styles.section} accessibilityRole="header">
              {t("groups.members.removed")}
            </Text>
          ) : (
            <MemberRow
              member={item.member!}
              me={myUid}
              meAdmin={meAdmin}
              manage={manage}
              removed={!!item.removed}
              busy={busyId === item.member!.userId}
              onOpenProfile={onOpenProfile}
              onRemove={(name) => setConfirm({ member: item.member!, name })}
              onReadmit={() => doReadmit(item.member!)}
            />
          )
        }
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
  // Not offered until the profile is known: never an empty name in the confirmation.
  const removable = !!profile && manage && member.userId !== me && (meAdmin || !profile.admin);
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
        <PressableScale
          onPress={onReadmit}
          style={styles.pill}
          accessibilityLabel={`${t("groups.members.readmit")}, ${name}`}
        >
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
    removed: { opacity: 0.6 },
    section: {
      ...theme.typography.caption,
      color: theme.colors.textFaint,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginHorizontal: theme.spacing(4),
      marginTop: theme.spacing(5),
      marginBottom: theme.spacing(1),
    },
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
