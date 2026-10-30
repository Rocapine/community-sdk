// Own-profile editor: avatar (tap it, pencil badge, to pick a photo), display
// name, handle and bio, all saved by one footer "Save" that stays disabled
// until something changed. A taken handle comes back with a free suggestion
// the user can take in one tap (core/009 + update-profile). Tapping outside a
// field closes the keyboard; a field the keyboard would cover scrolls into
// view. Ported from the mold's `ProfileEditSheet`, rebuilt on this package's
// `CommunitySheet`/theme/i18n. `updateProfile` is wrapped in try/catch: the
// service can throw on unexpected transport failures, surfaced as the same
// generic line as any other error.
//
// Notes:
//  - The sheet resolves its own identity (`useMyUid()`) and profile
//    (`useProfile(myUid)`). The form is seeded from `profile.data` exactly
//    once (`initializedRef`): re-syncing on every refetch would clobber
//    in-progress edits, since each saved field invalidates the profile query.
//    `base` holds the last saved values, which is what "changed" compares to.
//  - Save sends the changed fields one at a time (name, handle, bio, photo)
//    and stops at the first failure, shown under that field; the fields saved
//    before it stay saved (they move into `base`). Full success closes the
//    sheet.
//  - The picked photo is resized right away (`resizeAvatar`, optional
//    `expo-image-manipulator` peer) and previewed from the local file; it is
//    uploaded on save (`uploadAvatar`), then moderated by update-profile.
//  - No analytics calls here: `useUpdateProfile` emits `profileUpdated` itself.

import {
  useCommunityConfig,
  useMyUid,
  useProfile,
  useSetStreakVisibility,
  useUpdateProfile,
  uploadAvatar,
} from "@rocapine/community-core";
import type { BottomSheetScrollViewMethods } from "@gorhom/bottom-sheet";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Switch,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { haptic, PressableScale } from "../components/PressableScale";
import { Avatar } from "../components/Avatar";
import { CommunitySheet, SheetScrollView, SheetTextInput } from "../Sheet";
import { useCommunityIcons, useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";
import { resizeAvatar } from "../utils/avatar";
import { noFocusRing, noFocusRingMultiline } from "../utils/noFocusRing";

const BIO_MAX_LENGTH = 300;
const HANDLE_MAX_LENGTH = 20;
const NAME_MAX_LENGTH = 24;
const AVATAR_SIZE = 96;

type Field = "name" | "handle" | "bio";
type Saved = { name: string; handle: string; bio: string };

export function ProfileEditSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useCommunityTheme();
  const icons = useCommunityIcons();
  const t = useT();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);

  const myUid = useMyUid();
  const profile = useProfile(myUid);
  const updateProfile = useUpdateProfile();
  const streakVisibility = useSetStreakVisibility();

  const [base, setBase] = useState<Saved>({ name: "", handle: "", bio: "" });
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // Picked + resized, not uploaded yet: the preview, and what save uploads.
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);

  // Seed the form from the fetched profile exactly once — see file header.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !profile.data) return;
    initializedRef.current = true;
    const seeded = {
      name: profile.data.username ?? "",
      handle: profile.data.handle ?? "",
      bio: profile.data.bio ?? "",
    };
    setBase(seeded);
    setName(seeded.name);
    setHandle(seeded.handle);
    setBio(seeded.bio);
    setAvatarUrl(profile.data.avatarUrl);
  }, [profile.data]);

  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field | "photo", string>>>({});
  const [handleSuggestion, setHandleSuggestion] = useState<string | null>(null);

  const changed = {
    name: name.trim() !== base.name,
    handle: handle.trim().toLowerCase() !== base.handle,
    bio: bio.trim() !== base.bio,
    photo: pendingAvatar !== null,
  };
  const dirty = changed.name || changed.handle || changed.bio || changed.photo;

  // ---- keyboard: a focused field the keyboard would cover scrolls into view ----
  const scrollRef = useRef<BottomSheetScrollViewMethods>(null);
  const fieldY = useRef<Partial<Record<Field, number>>>({});
  const fieldViews = useRef<Partial<Record<Field, View | null>>>({});
  const focused = useRef<Field | null>(null);
  const keyboardTop = useRef<number | null>(null);
  const footerHeight = useRef(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const revealFocused = () => {
    const field = focused.current;
    const view = field ? fieldViews.current[field] : null;
    const y = field ? fieldY.current[field] : undefined;
    if (!view || y === undefined || keyboardTop.current === null) return;
    view.measureInWindow((_x, top, _w, height) => {
      const limit = (keyboardTop.current ?? 0) - footerHeight.current - theme.spacing(6);
      if (top + height > limit) {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - theme.spacing(4)), animated: true });
      }
    });
  };

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setKeyboardHeight(e.endCoordinates.height);
      revealFocused();
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardTop.current = null;
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
    // revealFocused only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fieldProps = (field: Field) => ({
    ref: (v: View | null) => {
      fieldViews.current[field] = v;
    },
    onLayout: (e: LayoutChangeEvent) => {
      fieldY.current[field] = e.nativeEvent.layout.y;
    },
  });
  const onFocus = (field: Field) => () => {
    focused.current = field;
    // Keyboard already up (moving between fields): no keyboardDidShow coming.
    if (keyboardTop.current !== null) revealFocused();
  };

  // ---- photo ----
  const pickPhoto = async () => {
    if (photoBusy || saving) return;
    haptic("selection");
    setErrors((e) => ({ ...e, photo: undefined }));
    setPhotoBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      const uri = result.canceled ? undefined : result.assets[0]?.uri;
      if (uri) setPendingAvatar(await resizeAvatar(uri));
    } catch {
      setErrors((e) => ({ ...e, photo: t("profile.genericError") }));
    } finally {
      setPhotoBusy(false);
    }
  };

  // ---- save: changed fields one at a time, stop at the first failure ----
  const saveName = async (): Promise<boolean> => {
    const res = await updateProfile.mutateAsync({ username: name.trim() });
    if (res.status === "ok") {
      setName(res.username ?? "");
      setBase((b) => ({ ...b, name: res.username ?? "" }));
      return true;
    }
    const message =
      res.status === "rejected"
        ? t("profile.displayNameRejected")
        : res.error === "invalid_username"
          ? t("profile.displayNameInvalid")
          : res.error === "reserved_name"
            ? t("profile.nameReserved")
            : t("profile.genericError");
    setErrors((e) => ({ ...e, name: message }));
    return false;
  };

  const saveHandle = async (value: string): Promise<boolean> => {
    const res = await updateProfile.mutateAsync({ handle: value.trim() });
    if (res.status === "ok") {
      // Reconcile the server-normalized (lowercased) value into the field.
      setHandle(res.handle ?? "");
      setBase((b) => ({ ...b, handle: res.handle ?? "" }));
      return true;
    }
    let message = t("profile.genericError");
    if (res.status === "rejected") message = t("profile.usernameRejected");
    else if (res.code === "handle_taken" && res.suggestion) {
      setHandleSuggestion(res.suggestion);
      message = t("profile.usernameSuggestion", {
        handle: value.trim().toLowerCase(),
        suggestion: res.suggestion,
      });
    } else if (res.code === "handle_taken") message = t("profile.usernameTaken");
    else if (res.error === "invalid_handle") message = t("profile.usernameInvalid");
    else if (res.error === "reserved_handle") message = t("profile.nameReserved");
    setErrors((e) => ({ ...e, handle: message }));
    return false;
  };

  const saveBio = async (): Promise<boolean> => {
    const res = await updateProfile.mutateAsync({ bio });
    if (res.status === "ok") {
      setBase((b) => ({ ...b, bio: res.bio ?? "" }));
      return true;
    }
    setErrors((e) => ({
      ...e,
      bio: res.status === "rejected" ? t("profile.bioRejected") : t("profile.genericError"),
    }));
    return false;
  };

  const savePhoto = async (uri: string): Promise<boolean> => {
    const path = await uploadAvatar(cfg, uri);
    const res = await updateProfile.mutateAsync({ avatarUrl: path });
    if (res.status === "ok") {
      setAvatarUrl(res.avatarUrl);
      setPendingAvatar(null);
      return true;
    }
    setErrors((e) => ({
      ...e,
      photo: res.status === "rejected" ? t("profile.photoRejected") : t("profile.genericError"),
    }));
    return false;
  };

  const save = async (handleOverride?: string) => {
    if (saving) return;
    Keyboard.dismiss();
    haptic("medium");
    setErrors({});
    setHandleSuggestion(null);
    setSaving(true);
    const nextHandle = handleOverride ?? handle;
    try {
      const ok =
        (!changed.name || (await saveName())) &&
        (nextHandle.trim().toLowerCase() === base.handle || (await saveHandle(nextHandle))) &&
        (!changed.bio || (await saveBio())) &&
        (pendingAvatar === null || (await savePhoto(pendingAvatar)));
      if (ok) {
        haptic("success");
        onClose();
      }
    } catch {
      setErrors((e) => ({ ...e, photo: e.photo ?? t("profile.genericError") }));
    } finally {
      setSaving(false);
    }
  };

  const takeSuggestion = () => {
    if (!handleSuggestion) return;
    setHandle(handleSuggestion);
    void save(handleSuggestion);
  };

  const shownAvatar = pendingAvatar ?? avatarUrl;
  const canSave = dirty && !saving && !photoBusy;

  return (
    <CommunitySheet
      visible={visible}
      onClose={onClose}
      snapTo="full"
      footer={
        profile.data ? (
          <View
            onLayout={(e) => {
              footerHeight.current = e.nativeEvent.layout.height;
            }}
          >
            <PressableScale
              onPress={() => save()}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={theme.colors.textInverse} />
              ) : (
                <Text style={styles.saveBtnLabel}>{t("profile.save")}</Text>
              )}
            </PressableScale>
          </View>
        ) : null
      }
    >
      <SheetScrollView
        scrollRef={scrollRef}
        // "handled": a tap outside a field (not on a button) closes the keyboard.
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardHeight }]}
      >
        <Text style={styles.title}>{t("profile.editProfile")}</Text>

        {!profile.data ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
        ) : (
          <>
            <View style={styles.avatarBlock}>
              <PressableScale
                onPress={pickPhoto}
                disabled={photoBusy || saving}
                accessibilityRole="button"
                accessibilityLabel={t("profile.changePhoto")}
                style={styles.avatarPress}
              >
                <Avatar
                  userId={myUid}
                  name={profile.data.name}
                  url={shownAvatar}
                  size={AVATAR_SIZE}
                />
                <View style={styles.pencilBadge}>
                  {photoBusy ? (
                    <ActivityIndicator size="small" color={theme.colors.textInverse} />
                  ) : (
                    <icons.compose size={15} color={theme.colors.textInverse} weight="bold" />
                  )}
                </View>
              </PressableScale>
              {errors.photo && <Text style={styles.errorCentered}>{errors.photo}</Text>}
            </View>

            <View style={styles.section} {...fieldProps("name")}>
              <Text style={styles.label}>{t("profile.displayNameLabel")}</Text>
              <SheetTextInput
                value={name}
                onChangeText={setName}
                onFocus={onFocus("name")}
                editable={!saving}
                autoCorrect={false}
                placeholder={profile.data.name}
                placeholderTextColor={theme.colors.textFaint}
                maxLength={NAME_MAX_LENGTH}
                style={styles.pillInput}
              />
              <Text style={styles.helper}>{t("profile.displayNameHelper")}</Text>
              {errors.name && <Text style={styles.errorText}>{errors.name}</Text>}
            </View>

            <View style={styles.section} {...fieldProps("handle")}>
              <Text style={styles.label}>{t("profile.usernameLabel")}</Text>
              <View style={styles.handleField}>
                <Text style={styles.handlePrefix}>@</Text>
                <SheetTextInput
                  value={handle}
                  onChangeText={setHandle}
                  onFocus={onFocus("handle")}
                  editable={!saving}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t("profile.usernamePlaceholder")}
                  placeholderTextColor={theme.colors.textFaint}
                  maxLength={HANDLE_MAX_LENGTH}
                  style={styles.handleInput}
                />
              </View>
              <Text style={styles.helper}>{t("profile.usernameHelper")}</Text>
              {errors.handle && <Text style={styles.errorText}>{errors.handle}</Text>}
              {handleSuggestion && (
                <PressableScale
                  onPress={takeSuggestion}
                  disabled={saving}
                  style={[styles.pill, styles.suggestionPill]}
                >
                  <Text style={styles.pillLabel}>
                    {t("profile.useSuggestion", { suggestion: handleSuggestion })}
                  </Text>
                </PressableScale>
              )}
            </View>

            {cfg.modules.streaks && (
              <View style={styles.section}>
                <Text style={styles.label}>{t("profile.streak")}</Text>
                <StreakToggle
                  label={t("profile.showStreak")}
                  value={profile.data.showStreak}
                  onChange={(on) => streakVisibility.mutateAsync({ showStreak: on })}
                />
                <StreakToggle
                  label={t("profile.showBestStreak")}
                  value={profile.data.showBestStreak}
                  onChange={(on) => streakVisibility.mutateAsync({ showBestStreak: on })}
                />
                <Text style={styles.helper}>{t("profile.streakHelper")}</Text>
              </View>
            )}

            <View style={styles.section} {...fieldProps("bio")}>
              <Text style={styles.label}>{t("profile.bioLabel")}</Text>
              <SheetTextInput
                value={bio}
                onChangeText={setBio}
                onFocus={onFocus("bio")}
                editable={!saving}
                placeholder={t("profile.bioPlaceholder")}
                placeholderTextColor={theme.colors.textFaint}
                multiline
                maxLength={BIO_MAX_LENGTH}
                style={styles.bioInput}
              />
              <Text style={styles.counter}>
                {bio.length}/{BIO_MAX_LENGTH}
              </Text>
              {errors.bio && <Text style={styles.errorText}>{errors.bio}</Text>}
            </View>
          </>
        )}
      </SheetScrollView>
    </CommunitySheet>
  );
}

/** One streak toggle, applied at once (not by Save). Local state keeps the
 * switch where the finger left it while the change lands; a failure puts it back. */
function StreakToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange(on: boolean): Promise<unknown>;
}) {
  const theme = useCommunityTheme();
  const styles = useThemedStyles(makeStyles);
  const [on, setOn] = useState(value);
  useEffect(() => setOn(value), [value]);
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={on}
        onValueChange={(next) => {
          haptic("selection");
          setOn(next);
          onChange(next).catch(() => setOn(!next));
        }}
        trackColor={{ true: theme.colors.accent, false: theme.colors.surfaceMuted }}
        accessibilityLabel={label}
      />
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    scrollContent: { paddingTop: theme.spacing(1) },
    loader: { marginTop: theme.spacing(8) },
    title: {
      fontFamily: theme.fonts.serifBold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 22,
      color: theme.colors.textPrimary,
      textAlign: "center",
      marginBottom: theme.spacing(5),
    },
    avatarBlock: { alignItems: "center" },
    avatarPress: { width: AVATAR_SIZE, height: AVATAR_SIZE },
    pencilBadge: {
      position: "absolute",
      right: 0,
      bottom: 0,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.colors.accent,
      borderWidth: 3,
      borderColor: theme.colors.background,
      alignItems: "center",
      justifyContent: "center",
    },
    pill: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2.5),
      paddingHorizontal: theme.spacing(4.5),
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
    },
    pillLabel: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13.5,
      color: theme.colors.textPrimary,
    },
    suggestionPill: { alignSelf: "flex-start", marginTop: theme.spacing(2.5) },
    section: { marginTop: theme.spacing(6) },
    label: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 13,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing(2),
    },
    pillInput: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(3),
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 15,
      color: theme.colors.textPrimary,
      ...noFocusRing,
    },
    bioInput: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      minHeight: 90,
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 15,
      lineHeight: 22,
      color: theme.colors.textPrimary,
      textAlignVertical: "top",
      ...noFocusRingMultiline,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(3),
      minHeight: 44,
    },
    toggleLabel: {
      flex: 1,
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 15,
      color: theme.colors.textPrimary,
    },
    counter: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 11.5,
      color: theme.colors.textFaint,
      textAlign: "right",
      marginTop: theme.spacing(2),
    },
    saveBtn: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(3.5),
      alignItems: "center",
      justifyContent: "center",
    },
    saveBtnDisabled: { opacity: 0.4 },
    saveBtnLabel: {
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
      fontSize: 15,
      color: theme.colors.textInverse,
    },
    handleField: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing(4),
    },
    handlePrefix: {
      fontFamily: theme.fonts.medium,
      fontWeight: theme.fontWeights.medium,
      fontSize: 15,
      color: theme.colors.textFaint,
      marginRight: 2,
    },
    handleInput: {
      flex: 1,
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 15,
      color: theme.colors.textPrimary,
      paddingVertical: theme.spacing(3),
      ...noFocusRing,
    },
    helper: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 12,
      color: theme.colors.textFaint,
      marginTop: theme.spacing(2),
    },
    errorText: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 12.5,
      color: theme.colors.danger,
      marginTop: theme.spacing(2),
    },
    errorCentered: {
      fontFamily: theme.fonts.regular,
      fontWeight: theme.fontWeights.regular,
      fontSize: 12.5,
      color: theme.colors.danger,
      marginTop: theme.spacing(2),
      textAlign: "center",
    },
  });
}
