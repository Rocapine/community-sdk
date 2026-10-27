// The one place the SDK draws a user's avatar (feed rows, comments, the reply
// bar, profiles, the edit preview, the header profile button, the composer).
// A host restyles every one of them at once through `CommunityUIProvider`'s
// `renderAvatar` (e.g. a gradient per member); the default stays dependency-free:
// the photo, else the initial on a flat colour.
import { Image } from "expo-image";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAvatarRenderer, useCommunityTheme } from "../ThemeProvider";
import { initialOf } from "../utils/initial";

export type AvatarRenderProps = {
  /** The member's community id; null when unknown (e.g. the viewer before sign-in). */
  userId: string | null;
  name: string;
  url: string | null;
  size: number;
};

export function Avatar(props: AvatarRenderProps): ReactElement {
  const render = useAvatarRenderer();
  if (render) return <>{render(props)}</>;
  return <DefaultAvatar {...props} />;
}

function DefaultAvatar({ name, url, size }: AvatarRenderProps): ReactElement {
  const theme = useCommunityTheme();
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (url) return <Image source={{ uri: url }} style={round} contentFit="cover" />;
  return (
    <View
      style={[
        round,
        styles.fallback,
        { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderStrong },
      ]}
    >
      <Text
        style={{
          fontFamily: theme.fonts.serifBold,
          fontWeight: theme.fontWeights.bold,
          fontSize: Math.round(size * 0.44),
          color: theme.colors.accent,
        }}
      >
        {initialOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
