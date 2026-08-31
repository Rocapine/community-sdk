// Own-profile editor: avatar picker + upload, bio, and username. Ported from
// the mold's `ProfileEditSheet` (`sdk/client/components/community/ProfileEditSheet.tsx`),
// rebuilt on this package's `CommunitySheet`/theme/i18n. Each of the three
// sections saves independently and keeps the sheet open on success, so a
// visitor can make several edits in one sitting. `updateProfile` is wrapped
// in try/catch everywhere: the service can throw on unexpected transport
// failures, surfaced as the same generic line as any other error.
//
// Differences from the mold, beyond the standard router-free transformations:
//  - No `profile: CommunityProfile` prop (task brief's signature is just
//    `{ visible, onClose }`): the sheet resolves its own identity
//    (`useMyUid()`) and profile (`useProfile(myUid)`) instead of receiving it
//    from a parent that already fetched one. Local form state (avatarUrl/
//    bio/handle) is seeded from `profile.data` exactly once, the first time
//    it loads (`initializedRef`) — re-syncing on every `profile.data` change
//    would clobber in-progress edits every time `useUpdateProfile`'s
//    `onSuccess` invalidates and refetches the profile query. While
//    `profile.data` hasn't arrived yet (sheet opened before the query
//    settles), the body renders a spinner instead of a form.
//  - `useAvatarPicker` (a separate mold hook) is folded directly into this
//    file per the task brief ("fold its pick→upload flow into
//    ProfileEditSheet"). The mold's resize/compress step
//    (`expo-image-manipulator`'s `ImageManipulator.manipulate().resize()...
//    .saveAsync({ base64: true })`) is dropped along with it — the brief only
//    authorizes adding `expo-image-picker` to this package's dependencies,
//    not `expo-image-manipulator` — so the picked image is passed straight to
//    `uploadAvatar(cfg, uri)` after `ImagePicker`'s own built-in
//    `allowsEditing`/`aspect` square crop. `uploadAvatar` itself already
//    differs from the mold's base64 upload (Task 5 ruling): it takes a local
//    `fileUri` and reads its bytes via `fetch`, so no Hermes/`atob` step was
//    needed here either way.
//  - No analytics calls in this file (controller ruling for this task):
//    `useUpdateProfile` already emits `profileUpdated` itself on every
//    successful mutation (`packages/core/src/hooks.ts`), so the mold's own
//    `trackCommunityProfileUpdated(...)` calls after each save would double
//    that event. Dropped entirely, not replaced.

import {
  useCommunityConfig,
  useMyUid,
  useProfile,
  useUpdateProfile,
  uploadAvatar,
} from "@rocapine/community-core";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CommunitySheet } from "../Sheet";
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";

const BIO_MAX_LENGTH = 300;
const HANDLE_MAX_LENGTH = 20;

export function ProfileEditSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useCommunityTheme();
  const t = useT();
  const cfg = useCommunityConfig();
  const styles = useThemedStyles(makeStyles);

  const myUid = useMyUid();
  const profile = useProfile(myUid);
  const updateProfile = useUpdateProfile();

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [handle, setHandle] = useState("");

  // Seed the form from the fetched profile exactly once — see file header.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !profile.data) return;
    initializedRef.current = true;
    setAvatarUrl(profile.data.avatarUrl);
    setBio(profile.data.bio ?? "");
    setHandle(profile.data.handle ?? "");
  }, [profile.data]);

  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);
  const [handleBusy, setHandleBusy] = useState(false);
  const [handleError, setHandleError] = useState<string | null>(null);

  const pickPhoto = async () => {
    if (photoBusy) return;
    Haptics.selectionAsync().catch(() => {});
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled) return;
      const uri = result.assets[0]?.uri;
      if (!uri) return;
      const path = await uploadAvatar(cfg, uri);
      const res = await updateProfile.mutateAsync({ avatarUrl: path });
      if (res.status === "ok") {
        setAvatarUrl(res.avatarUrl);
      } else if (res.status === "rejected") {
        setPhotoError(t("profile.photoRejected"));
      } else {
        setPhotoError(t("profile.genericError"));
      }
    } catch {
      setPhotoError(t("profile.genericError"));
    } finally {
      setPhotoBusy(false);
    }
  };

  const saveBio = async () => {
    if (bioBusy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setBioError(null);
    setBioBusy(true);
    try {
      const res = await updateProfile.mutateAsync({ bio });
      if (res.status === "rejected") {
        setBioError(t("profile.bioRejected"));
      } else if (res.status === "error") {
        setBioError(t("profile.genericError"));
      }
    } catch {
      setBioError(t("profile.genericError"));
    } finally {
      setBioBusy(false);
    }
  };

  const saveHandle = async () => {
    if (handleBusy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setHandleError(null);
    setHandleBusy(true);
    try {
      const res = await updateProfile.mutateAsync({ handle: handle.trim() });
      if (res.status === "ok") {
        // Reconcile the server-normalized (lowercased) value into the field.
        setHandle(res.handle ?? "");
      } else if (res.status === "rejected") {
        setHandleError(t("profile.usernameRejected"));
      } else if (res.status === "error" && res.code === "handle_taken") {
        setHandleError(t("profile.usernameTaken"));
      } else if (res.status === "error" && res.error === "invalid_handle") {
        setHandleError(t("profile.usernameInvalid"));
      } else {
        setHandleError(t("profile.genericError"));
      }
    } catch {
      setHandleError(t("profile.genericError"));
    } finally {
      setHandleBusy(false);
    }
  };

  return (
    <CommunitySheet visible={visible} onClose={onClose} snapTo="full">
      <ScrollView
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.title}>{t("profile.editProfile")}</Text>

        {!profile.data ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
        ) : (
          <>
            <View style={styles.photoRow}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarLetter}>
                    {profile.data.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <Pressable
                onPress={pickPhoto}
                disabled={photoBusy}
                style={({ pressed }) => [styles.pill, (photoBusy || pressed) && styles.pressed]}
              >
                {photoBusy ? (
                  <ActivityIndicator size="small" color={theme.colors.textPrimary} />
                ) : (
                  <Text style={styles.pillLabel}>{t("profile.changePhoto")}</Text>
                )}
              </Pressable>
            </View>
            {photoError && <Text style={styles.errorText}>{photoError}</Text>}

            <View style={styles.section}>
              <Text style={styles.label}>{t("profile.bioLabel")}</Text>
              <TextInput
                value={bio}
                onChangeText={setBio}
                editable={!bioBusy}
                placeholder={t("profile.bioPlaceholder")}
                placeholderTextColor={theme.colors.textFaint}
                multiline
                maxLength={BIO_MAX_LENGTH}
                style={styles.bioInput}
              />
              <View style={styles.rowBetween}>
                <Text style={styles.counter}>
                  {bio.length}/{BIO_MAX_LENGTH}
                </Text>
                <Pressable
                  onPress={saveBio}
                  disabled={bioBusy}
                  style={({ pressed }) => [styles.saveBtn, (bioBusy || pressed) && styles.pressed]}
                >
                  {bioBusy ? (
                    <ActivityIndicator size="small" color={theme.colors.textInverse} />
                  ) : (
                    <Text style={styles.saveBtnLabel}>{t("profile.save")}</Text>
                  )}
                </Pressable>
              </View>
              {bioError && <Text style={styles.errorText}>{bioError}</Text>}
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>{t("profile.usernameLabel")}</Text>
              <View style={styles.handleField}>
                <Text style={styles.handlePrefix}>@</Text>
                <TextInput
                  value={handle}
                  onChangeText={setHandle}
                  editable={!handleBusy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t("profile.usernamePlaceholder")}
                  placeholderTextColor={theme.colors.textFaint}
                  maxLength={HANDLE_MAX_LENGTH}
                  style={styles.handleInput}
                />
              </View>
              <Text style={styles.helper}>{t("profile.usernameHelper")}</Text>
              <Pressable
                onPress={saveHandle}
                disabled={handleBusy}
                style={({ pressed }) => [
                  styles.saveBtn,
                  styles.saveBtnAlone,
                  (handleBusy || pressed) && styles.pressed,
                ]}
              >
                {handleBusy ? (
                  <ActivityIndicator size="small" color={theme.colors.textInverse} />
                ) : (
                  <Text style={styles.saveBtnLabel}>{t("profile.save")}</Text>
                )}
              </Pressable>
              {handleError && <Text style={styles.errorText}>{handleError}</Text>}
            </View>
          </>
        )}
      </ScrollView>
    </CommunitySheet>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    scrollContent: { paddingBottom: theme.spacing(6) },
    loader: { marginTop: theme.spacing(8) },
    title: {
      fontFamily: theme.fonts.serifBold,
      fontSize: 22,
      color: theme.colors.textPrimary,
      marginBottom: theme.spacing(5),
    },
    photoRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(4) },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarImage: { width: 64, height: 64, borderRadius: 32 },
    avatarLetter: { fontFamily: theme.fonts.serifBold, fontSize: 26, color: theme.colors.accent },
    pill: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2.5),
      paddingHorizontal: theme.spacing(4.5),
      borderWidth: 1,
      borderColor: theme.colors.border,
      minWidth: 128,
      alignItems: "center",
    },
    pressed: { opacity: 0.7 },
    pillLabel: { fontFamily: theme.fonts.medium, fontSize: 13.5, color: theme.colors.textPrimary },
    section: { marginTop: theme.spacing(6.5) },
    label: {
      fontFamily: theme.fonts.medium,
      fontSize: 13,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing(2),
    },
    bioInput: {
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      minHeight: 90,
      fontFamily: theme.fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: theme.colors.textPrimary,
      textAlignVertical: "top",
    },
    rowBetween: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: theme.spacing(2.5),
    },
    counter: { fontFamily: theme.fonts.regular, fontSize: 11.5, color: theme.colors.textFaint },
    saveBtn: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.spacing(2.5),
      paddingHorizontal: theme.spacing(5.5),
      alignItems: "center",
      justifyContent: "center",
      minWidth: 76,
    },
    saveBtnAlone: { alignSelf: "flex-start", marginTop: theme.spacing(3) },
    saveBtnLabel: { fontFamily: theme.fonts.bold, fontSize: 13.5, color: theme.colors.textInverse },
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
      fontSize: 15,
      color: theme.colors.textFaint,
      marginRight: 2,
    },
    handleInput: {
      flex: 1,
      fontFamily: theme.fonts.regular,
      fontSize: 15,
      color: theme.colors.textPrimary,
      paddingVertical: theme.spacing(3),
    },
    helper: {
      fontFamily: theme.fonts.regular,
      fontSize: 12,
      color: theme.colors.textFaint,
      marginTop: theme.spacing(2),
    },
    errorText: {
      fontFamily: theme.fonts.regular,
      fontSize: 12.5,
      color: theme.colors.danger,
      marginTop: theme.spacing(2),
    },
  });
}
