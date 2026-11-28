// The message a reply quotes, inside the reply's bubble: "@handle" and the first two
// lines of its current text (or "Message deleted"). Tapping it jumps to the original.
import { useProfile, type ChatMessage } from "@rocapine/community-core";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useT, useThemedStyles } from "../../ThemeProvider";
import type { CommunityTheme } from "../../theme";
import { quoteExcerpt } from "../../utils/chat";

export function QuoteBlock({
  replyTo,
  color,
  onPress,
}: {
  replyTo: NonNullable<ChatMessage["replyTo"]>;
  /** The bubble's text color: the bar and the text take it. */
  color: string;
  onPress(): void;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const author = useProfile(replyTo.authorId || null).data;
  const excerpt = quoteExcerpt(replyTo.body, replyTo.deleted, t) || t("image.photo");
  return (
    <Pressable
      onPress={onPress}
      style={[styles.quote, { borderLeftColor: color }]}
      accessibilityRole="button"
    >
      {/* A tint of the bubble's own text color: reads on any bubble, any theme. */}
      <View style={[StyleSheet.absoluteFill, styles.tint, { backgroundColor: color }]} />
      {author && (
        <Text style={[styles.author, { color }]} numberOfLines={1}>
          @{author.handle ?? author.name}
        </Text>
      )}
      <Text style={[styles.excerpt, { color }]} numberOfLines={2}>
        {excerpt}
      </Text>
    </Pressable>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    quote: {
      borderLeftWidth: 3,
      borderRadius: theme.radius.sm,
      paddingVertical: theme.spacing(1),
      paddingHorizontal: theme.spacing(2),
      marginBottom: theme.spacing(1.25),
      overflow: "hidden",
    },
    tint: { opacity: 0.12 },
    author: {
      ...theme.typography.caption,
      fontFamily: theme.fonts.bold,
      fontWeight: theme.fontWeights.bold,
    },
    excerpt: { ...theme.typography.caption, opacity: 0.8 },
  });
}
