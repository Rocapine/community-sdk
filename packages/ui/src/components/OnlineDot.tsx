// The green "online" dot at an avatar's bottom-right corner. Presence is only ever
// shown, never its absence: there is no grey/offline variant. The dot is static.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { useCommunityTheme, useT } from "../ThemeProvider";
import { onlineDotMetrics } from "../utils/onlineDot";

export function OnlineDot({
  size,
  ringColor,
}: {
  size: number;
  /** The surface behind the avatar, so the ring reads as a cut-out. */
  ringColor: string;
}): ReactElement {
  const t = useT();
  const theme = useCommunityTheme();
  const { dot, ring } = onlineDotMetrics(size);
  const outer = dot + 2 * ring;

  return (
    <View
      accessible
      accessibilityLabel={t("a11y.online")}
      style={[styles.slot, { width: outer, height: outer }]}
    >
      <View
        style={[
          styles.fill,
          {
            borderRadius: outer / 2,
            backgroundColor: theme.colors.success,
            borderWidth: ring,
            borderColor: ringColor,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute", right: 0, bottom: 0 },
  fill: { ...StyleSheet.absoluteFill },
});
