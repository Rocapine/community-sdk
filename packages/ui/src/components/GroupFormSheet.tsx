// Create or edit a group (validated mockup A: one sheet): an optional image, the name
// and the description with their counters, and a line saying the group is public and
// checked before it appears. "Create" / "Save" sits top right, enabled once both
// fields are filled (and, when editing, something changed). Also exports the notice
// a creator sees while their group is under review or has a field rejected.
import {
  MessagingError,
  groupsSettings,
  useCommunityConfig,
  useCreateGroup,
  useEditGroup,
  type Group,
  type LocalImage,
} from "@rocapine/community-core";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { CommunitySheet, SheetScrollView, SheetTextInput } from "../Sheet";
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { groupErrorKey } from "../utils/groups";
import { noFocusRing, noFocusRingMultiline } from "../utils/noFocusRing";
import { imagesSupported, pickImage } from "../utils/postImage";
import { Avatar } from "./Avatar";
import { PressableScale, haptic } from "./PressableScale";

type FieldError = { name?: string; description?: string; form?: string };

export function GroupFormSheet({
  visible,
  mode,
  group,
  onDone,
  onClose,
}: {
  visible: boolean;
  mode: "create" | "edit";
  /** The group to edit (`mode: "edit"`). */
  group?: Group;
  /** Created (its id) or saved. */
  onDone(id: string): void;
  onClose(): void;
}) {
  const cfg = useCommunityConfig();
  const t = useT();
  const theme = useCommunityTheme();
  const styles = useThemedStyles(makeStyles);
  const settings = groupsSettings(cfg);
  const create = useCreateGroup();
  const edit = useEditGroup();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<LocalImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [errors, setErrors] = useState<FieldError>({});
  const [imagesOn] = useState(imagesSupported);

  // Each opening starts from the group's values (edit) or blank (create).
  useEffect(() => {
    if (!visible) return;
    setName(mode === "edit" ? (group?.name ?? "") : "");
    setDescription(mode === "edit" ? (group?.description ?? "") : "");
    setImage(null);
    setErrors({});
    // Seeded once per opening: a refetch must not clobber what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!settings) return null;
  const busy = create.isPending || edit.isPending;
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const changed = {
    name: mode === "create" || trimmedName !== (group?.name ?? ""),
    description: mode === "create" || trimmedDescription !== (group?.description ?? ""),
  };
  const dirty = mode === "create" || changed.name || changed.description || image !== null;
  const canSubmit = !!trimmedName && !!trimmedDescription && dirty && !busy && !preparing;

  const pick = async () => {
    if (preparing || busy) return;
    setPreparing(true);
    try {
      const picked = await pickImage();
      if (picked) setImage(picked);
    } catch {
      setErrors({ form: t("groups.error.generic") });
    } finally {
      setPreparing(false);
    }
  };

  const fail = (e: unknown) => {
    const code = e instanceof MessagingError ? e.code : "unknown";
    if (code === "account_required") {
      onClose();
      cfg.host.onAccountRequired?.("createGroup");
      return;
    }
    const message = t(groupErrorKey(code));
    if (code === "name_required" || code === "name_too_long") setErrors({ name: message });
    else if (code === "description_required" || code === "description_too_long")
      setErrors({ description: message });
    else setErrors({ form: message });
  };

  const submit = () => {
    if (!canSubmit) return;
    setErrors({});
    haptic("medium");
    const done = (id: string) => {
      haptic("success");
      onDone(id);
    };
    if (mode === "create") {
      create.mutate(
        {
          name: trimmedName,
          description: trimmedDescription,
          ...(image ? { imageUri: image.url } : {}),
        },
        { onSuccess: done, onError: fail },
      );
    } else if (group) {
      edit.mutate(
        {
          groupId: group.id,
          ...(changed.name ? { name: trimmedName } : {}),
          ...(changed.description ? { description: trimmedDescription } : {}),
          ...(image ? { imageUri: image.url } : {}),
        },
        { onSuccess: () => done(group.id), onError: fail },
      );
    }
  };

  const rejected = (field: string) =>
    mode === "edit" && group?.rejectedFields.includes(field) ? (
      <Text style={styles.error}>{t(`groups.review.rejected.${field}`)}</Text>
    ) : null;
  const shownImage = image?.url ?? (mode === "edit" ? (group?.imageUrl ?? null) : null);

  return (
    <CommunitySheet visible={visible} onClose={onClose} snapTo="full">
      <SheetScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.topSide}>
            <Text style={styles.cancel}>{t("menu.cancel")}</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
            {t(mode === "create" ? "groups.form.createTitle" : "groups.form.editTitle")}
          </Text>
          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit, busy }}
            style={[styles.topSide, styles.topRight]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            ) : (
              <Text style={[styles.submit, !canSubmit && styles.disabled]}>
                {t(mode === "create" ? "groups.form.create" : "profile.save")}
              </Text>
            )}
          </Pressable>
        </View>

        {imagesOn && (
          <View style={styles.imageBlock}>
            <PressableScale
              onPress={() => void pick()}
              disabled={preparing || busy}
              accessibilityLabel={t(
                shownImage ? "groups.form.changeImage" : "groups.form.addImage",
              )}
            >
              {shownImage ? (
                <Avatar
                  userId={null}
                  name={name}
                  url={shownImage}
                  size={IMAGE_SIZE}
                  placement="group"
                />
              ) : (
                <View style={styles.imageEmpty}>
                  {preparing ? (
                    <ActivityIndicator color={theme.colors.accent} />
                  ) : (
                    <Text style={styles.imagePlus}>+</Text>
                  )}
                </View>
              )}
            </PressableScale>
            <Text style={styles.imageLabel}>
              {t(shownImage ? "groups.form.changeImage" : "groups.form.addImage")}
            </Text>
            {rejected("image")}
          </View>
        )}

        <Text style={styles.label}>{t("groups.form.name")}</Text>
        <SheetTextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            setErrors({});
          }}
          editable={!busy}
          placeholder={t("groups.form.namePlaceholder")}
          placeholderTextColor={theme.colors.textFaint}
          maxLength={settings.nameMaxLength}
          accessibilityLabel={t("groups.form.name")}
          style={styles.input}
        />
        <Text style={styles.counter}>
          {name.length} / {settings.nameMaxLength}
        </Text>
        {errors.name && <Text style={styles.error}>{errors.name}</Text>}
        {rejected("name")}

        <Text style={styles.label}>{t("groups.form.description")}</Text>
        <SheetTextInput
          value={description}
          onChangeText={(v) => {
            setDescription(v);
            setErrors({});
          }}
          editable={!busy}
          multiline
          placeholder={t("groups.form.descriptionPlaceholder")}
          placeholderTextColor={theme.colors.textFaint}
          maxLength={settings.descriptionMaxLength}
          accessibilityLabel={t("groups.form.description")}
          style={styles.area}
        />
        <Text style={styles.counter}>
          {description.length} / {settings.descriptionMaxLength}
        </Text>
        {errors.description && <Text style={styles.error}>{errors.description}</Text>}
        {rejected("description")}

        <Text style={styles.note}>{t("groups.form.publicNote")}</Text>
        {errors.form && <Text style={[styles.error, styles.center]}>{errors.form}</Text>}
      </SheetScrollView>
    </CommunitySheet>
  );
}

/** What a group's creator sees while it is under review (not visible to others) or a
 * field was rejected, with an Edit action. Nothing for anyone else. */
export function GroupReviewNotice({ group }: { group: Group | null | undefined }) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const [editing, setEditing] = useState(false);
  if (!group?.isCreator) return null;
  const pending = group.status === "pending";
  if (!pending && group.rejectedFields.length === 0) return null;
  return (
    <View style={styles.notice}>
      {pending && (
        <View style={styles.chip}>
          <Text style={styles.chipLabel}>{t("groups.underReview")}</Text>
        </View>
      )}
      {pending && <Text style={styles.noticeText}>{t("groups.review.pending")}</Text>}
      {group.rejectedFields.map((f) => (
        <Text key={f} style={[styles.noticeText, styles.dangerText]}>
          {t(`groups.review.rejected.${f}`)}
        </Text>
      ))}
      {group.rejectedFields.length > 0 && (
        <PressableScale onPress={() => setEditing(true)} style={styles.noticeButton}>
          <Text style={styles.noticeButtonLabel}>{t("chat.menu.edit")}</Text>
        </PressableScale>
      )}
      <GroupFormSheet
        visible={editing}
        mode="edit"
        group={group}
        onDone={() => setEditing(false)}
        onClose={() => setEditing(false)}
      />
    </View>
  );
}

const IMAGE_SIZE = 88;

function makeStyles(theme: CommunityTheme) {
  const input = {
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    ...theme.typography.input,
    color: theme.colors.textPrimary,
  };
  return StyleSheet.create({
    top: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 44,
      marginBottom: theme.spacing(3),
    },
    topSide: { minWidth: 72, minHeight: 44, justifyContent: "center" },
    topRight: { alignItems: "flex-end" },
    cancel: { ...theme.typography.label, color: theme.colors.textMuted },
    title: {
      flex: 1,
      textAlign: "center",
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textPrimary,
    },
    submit: {
      ...theme.typography.label,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.accent,
    },
    disabled: { opacity: 0.4 },
    imageBlock: { alignItems: "center", gap: theme.spacing(2), marginBottom: theme.spacing(2) },
    imageEmpty: {
      width: IMAGE_SIZE,
      height: IMAGE_SIZE,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    imagePlus: { ...theme.typography.display, color: theme.colors.accent },
    imageLabel: { ...theme.typography.caption, color: theme.colors.textMuted },
    label: {
      ...theme.typography.meta,
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      color: theme.colors.textMuted,
      marginTop: theme.spacing(4),
      marginBottom: theme.spacing(2),
    },
    input: { ...input, ...noFocusRing },
    area: { ...input, minHeight: 110, textAlignVertical: "top", ...noFocusRingMultiline },
    counter: {
      ...theme.typography.caption,
      color: theme.colors.textFaint,
      textAlign: "right",
      marginTop: theme.spacing(1),
    },
    error: { ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing(1) },
    center: { textAlign: "center", marginTop: theme.spacing(3) },
    note: {
      ...theme.typography.meta,
      color: theme.colors.textMuted,
      textAlign: "center",
      marginTop: theme.spacing(5),
    },
    notice: {
      margin: theme.spacing(3),
      padding: theme.spacing(3),
      gap: theme.spacing(2),
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "flex-start",
    },
    chip: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing(2.5),
      paddingVertical: theme.spacing(1),
    },
    chipLabel: {
      ...theme.typography.caption,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textSecondary,
    },
    noticeText: { ...theme.typography.meta, color: theme.colors.textSecondary },
    dangerText: { color: theme.colors.danger },
    noticeButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
    },
    noticeButtonLabel: {
      ...theme.typography.meta,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      color: theme.colors.textInverse,
    },
  });
}
