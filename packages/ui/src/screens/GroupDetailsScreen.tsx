// A group's details (validated mockup B: settings list): the header (picture, name,
// "N members · X online", description), then rows — Notifications (the chat header's
// bell, same setting), Members (opens the list; members only, others see the count),
// Share in the community — and Report and Leave. Whoever manages the group (its active
// creator, an app admin, as `can_manage_group`) also gets Edit and Delete (and, in the
// member list, Remove / Readmit). A plain screen: the host pads the
// top. Renders nothing when the groups module is off.
import {
  COMMUNITY_EVENTS,
  emitEvent,
  groupsSettings,
  useCommunityConfig,
  useConversations,
  useGroup,
  useGroupOnlineCounts,
  useDeleteGroup,
  useLeaveGroup,
  useMyUid,
  useProfile,
  useSetGroupNotify,
  type Group,
} from "@rocapine/community-core";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { Avatar } from "../components/Avatar";
import { GroupFormSheet, GroupReviewNotice } from "../components/GroupFormSheet";
import { OnlineLabel } from "../components/OnlineLabel";
import { ReportSheet, type ReportTarget } from "../components/ReportSheet";
import { ScreenBackground } from "../components/ScreenBackground";
import { MessageMenu } from "../components/chat/MessageMenu";
import { canManage } from "../utils/groups";
import { isQueryLoading } from "../utils/query";
import { ToggleRow } from "./ProfileEditSheet";

export type GroupDetailsScreenProps = {
  groupId: string;
  onOpenMembers(): void;
  /** "Share in the community": the host opens the composer with the group's card. */
  onShare(group: Group): void;
  /** I left or deleted the group: leave the screen (and the conversation under it). */
  onLeft(): void;
  onBack(): void;
};

export function GroupDetailsScreen(props: GroupDetailsScreenProps) {
  const cfg = useCommunityConfig();
  if (!groupsSettings(cfg)) return null;
  return <Details {...props} />;
}

function Details({ groupId, onOpenMembers, onShare, onLeft, onBack }: GroupDetailsScreenProps) {
  const cfg = useCommunityConfig();
  const t = useT();
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const styles = useThemedStyles(makeStyles);
  const myUid = useMyUid();
  const meAdmin = !!useProfile(myUid).data?.admin;
  const groupQuery = useGroup(groupId);
  const group = groupQuery.data;
  const online = useGroupOnlineCounts([groupId])[groupId] ?? 0;
  const conversation = useConversations().data?.find((c) => c.id === groupId);
  const setNotify = useSetGroupNotify();
  const leave = useLeaveGroup();
  const remove = useDeleteGroup();

  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const failed = () => setError(t("groups.error.generic"));

  const header = (
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
        {t("groups.details.title")}
      </Text>
      <View style={styles.headerButton} />
    </View>
  );

  if (!group)
    return (
      <View style={styles.root}>
        <ScreenBackground />
        {header}
        {isQueryLoading(groupQuery) ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
        ) : (
          <Text style={styles.empty}>
            {t(groupQuery.isError ? "feed.unreachableRetry" : "chat.groupDeleted")}
          </Text>
        )}
      </View>
    );

  const member = group.isMember;
  const manage = canManage(group, meAdmin);
  const canReport = !group.isCreator && !!group.creatorId && group.creatorId !== myUid;

  return (
    <View style={styles.root}>
      <ScreenBackground />
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Avatar
            userId={null}
            name={group.name}
            url={group.imageUrl}
            size={80}
            placement="group"
          />
          <Text style={styles.name}>{group.name}</Text>
          <Text style={styles.stats}>
            {t("chat.members", { count: group.memberCount })}
            {online > 0 && (
              <>
                {" · "}
                <OnlineLabel count={online} />
              </>
            )}
          </Text>
          {!!group.description && <Text style={styles.description}>{group.description}</Text>}
        </View>
        <GroupReviewNotice group={group} />
        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.list}>
          {member && (
            <View style={styles.toggleRow}>
              <ToggleRow
                label={t("chat.notify")}
                value={conversation?.notify ?? false}
                onChange={(on) => {
                  setError(null);
                  return setNotify.mutateAsync({ groupId, notify: on }).catch((e: unknown) => {
                    failed();
                    throw e;
                  });
                }}
              />
            </View>
          )}
          <Row
            label={t("groups.details.members")}
            value={String(group.memberCount)}
            onPress={member ? onOpenMembers : undefined}
            divider={member}
          />
          {member && group.status === "visible" && (
            <Row
              label={t("groups.details.share")}
              onPress={() => {
                emitEvent(cfg, COMMUNITY_EVENTS.groupShared, { groupId });
                onShare(group);
              }}
              divider
            />
          )}
          {manage && (
            <Row label={t("groups.details.edit")} onPress={() => setEditing(true)} divider />
          )}
        </View>

        {(canReport || member || manage) && (
          <View style={styles.list}>
            {canReport && (
              <Row
                label={t("groups.details.report")}
                onPress={() =>
                  setReportTarget({ kind: "group", id: groupId, authorId: group.creatorId! })
                }
              />
            )}
            {member && (
              <Row
                label={t("groups.details.leave")}
                danger
                onPress={() => setConfirmLeave(true)}
                divider={canReport}
              />
            )}
            {manage && (
              <Row
                label={t("groups.details.delete")}
                danger
                onPress={() => setConfirmDelete(true)}
                divider={canReport || member}
              />
            )}
          </View>
        )}
      </ScrollView>

      <MessageMenu
        visible={confirmLeave}
        title={t("groups.details.leaveConfirm")}
        actions={[
          {
            key: "leave",
            label: t("groups.details.leave"),
            destructive: true,
            onPress: () => {
              setError(null);
              leave.mutate({ groupId }, { onSuccess: onLeft, onError: failed });
            },
          },
        ]}
        onClose={() => setConfirmLeave(false)}
      />
      <MessageMenu
        visible={confirmDelete}
        title={t("groups.details.deleteConfirm")}
        actions={[
          {
            key: "delete",
            label: t("groups.details.delete"),
            destructive: true,
            onPress: () => {
              setError(null);
              remove.mutate({ groupId }, { onSuccess: onLeft, onError: failed });
            },
          },
        ]}
        onClose={() => setConfirmDelete(false)}
      />
      <GroupFormSheet
        visible={editing}
        mode="edit"
        group={group}
        onDone={() => setEditing(false)}
        onClose={() => setEditing(false)}
      />
      <ReportSheet
        visible={reportTarget !== null}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
      />
    </View>
  );
}

/** One settings row: a label, an optional value and a chevron when it opens something. */
function Row({
  label,
  value,
  onPress,
  danger,
  divider,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  divider?: boolean;
}) {
  const theme = useCommunityTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={value ? `${label}, ${value}` : label}
    >
      <Text style={[styles.rowLabel, danger && { color: theme.colors.danger }]}>{label}</Text>
      {value !== undefined && <Text style={styles.rowValue}>{value}</Text>}
      {onPress && !danger && <Text style={styles.chevron}>›</Text>}
    </Pressable>
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
    loader: { marginTop: theme.spacing(8) },
    empty: {
      ...theme.typography.bodySmall,
      color: theme.colors.textFaint,
      textAlign: "center",
      marginTop: theme.spacing(6),
      paddingHorizontal: theme.spacing(6),
    },
    content: { paddingBottom: theme.spacing(10) },
    hero: {
      alignItems: "center",
      gap: theme.spacing(1.5),
      paddingHorizontal: theme.spacing(6),
      paddingVertical: theme.spacing(4),
    },
    name: {
      ...theme.typography.heading,
      color: theme.colors.textPrimary,
      textAlign: "center",
      marginTop: theme.spacing(1.5),
    },
    stats: { ...theme.typography.meta, color: theme.colors.textMuted },
    description: {
      ...theme.typography.bodySmall,
      color: theme.colors.textSecondary,
      textAlign: "center",
      marginTop: theme.spacing(1),
    },
    error: {
      ...theme.typography.caption,
      color: theme.colors.danger,
      textAlign: "center",
      marginHorizontal: theme.spacing(4),
      marginBottom: theme.spacing(2),
    },
    list: {
      marginHorizontal: theme.spacing(4),
      marginTop: theme.spacing(4),
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      minHeight: 48,
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(1),
    },
    // A column, so the switch row spans the width: its label and switch then center
    // on one line, like the other rows.
    toggleRow: {
      justifyContent: "center",
      minHeight: 48,
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(1),
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.hairline },
    pressed: { backgroundColor: theme.colors.hairline },
    rowLabel: { flex: 1, ...theme.typography.body, color: theme.colors.textPrimary },
    rowValue: { ...theme.typography.body, color: theme.colors.textMuted },
    // The body's font at a larger size, its line box no taller than the label's: the
    // title's serif sat the "›" off the row's center.
    chevron: {
      ...theme.typography.body,
      fontSize: 22,
      lineHeight: 22,
      includeFontPadding: false,
      color: theme.colors.textFaint,
    },
  });
}
