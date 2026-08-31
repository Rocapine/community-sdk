// A post's poll — feed card and thread sheet both render this. Ported from
// the mold's `PollBlock` (`sdk/client/components/community/PollBlock.tsx`,
// mirrored unchanged in Eve's Rhythm). Options stay plain tappable rows
// until the reader votes (or owns the post); then they become result bars.
// Tapping another option moves the vote.
//
// Signature change from both sources (task brief): takes the whole `post`
// instead of `{ poll, isOwn, onVote }` — voting now happens inside this
// component via `useVotePoll`, passing the option's row UUID (not an index).
// An option is disabled while it still carries an optimistic temp id
// (`temp-N`, assigned by `useCreatePost`'s optimistic poll — see core's
// hooks.ts) since the real uuids only land once the post's moderation
// verdict resolves and the feed refetches.

import { pollPercent, useVotePoll, type FeedPost } from "@rocapine/community-core";
import { CheckCircle } from "phosphor-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useCommunityTheme, useT, useThemedStyles } from "../ThemeProvider";
import type { CommunityTheme } from "../theme";

export function PollBlock({ post }: { post: FeedPost }) {
  const theme = useCommunityTheme();
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const votePoll = useVotePoll();

  const poll = post.poll;
  if (!poll) return null;

  const showResults = poll.myOptionId !== null || post.isOwn;

  return (
    <View style={styles.block}>
      {poll.options.map((option) => {
        const mine = option.id === poll.myOptionId;
        const optimistic = option.id.startsWith("temp-");
        const pct = pollPercent(option.votes, poll.totalVotes);
        return (
          <Pressable
            key={option.id}
            disabled={mine || optimistic}
            onPress={() => votePoll.mutate({ postId: post.id, optionId: option.id })}
            style={({ pressed }) => [
              styles.option,
              mine && styles.optionMine,
              pressed && styles.optionPressed,
            ]}
          >
            {showResults && (
              <View
                style={[styles.fill, mine && styles.fillMine, { width: `${pct}%` }]}
                pointerEvents="none"
              />
            )}
            <View style={styles.optionRow}>
              <Text style={[styles.label, mine && styles.labelMine]} numberOfLines={2}>
                {option.label}
              </Text>
              {mine && <CheckCircle size={16} color={theme.colors.accent} weight="fill" />}
              {showResults && <Text style={[styles.pct, mine && styles.labelMine]}>{pct}%</Text>}
            </View>
          </Pressable>
        );
      })}
      <Text style={styles.total}>
        {showResults ? t("poll.votes", { count: poll.totalVotes }) : t("poll.tapToVote")}
      </Text>
    </View>
  );
}

function makeStyles(theme: CommunityTheme) {
  return StyleSheet.create({
    block: { marginTop: theme.spacing(3), gap: theme.spacing(2) },
    option: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.sm + 4,
      backgroundColor: theme.colors.surfaceMuted,
      overflow: "hidden",
    },
    optionMine: { borderColor: theme.colors.borderStrong },
    optionPressed: { opacity: 0.85 },
    fill: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: theme.colors.border,
    },
    fillMine: { backgroundColor: theme.colors.borderStrong },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingHorizontal: theme.spacing(3.5),
      paddingVertical: theme.spacing(2.75),
    },
    label: {
      flex: 1,
      fontFamily: theme.fonts.medium,
      fontSize: 13.5,
      color: theme.colors.textSecondary,
    },
    labelMine: { color: theme.colors.accent },
    pct: {
      fontFamily: theme.fonts.bold,
      fontSize: 13,
      color: theme.colors.textMuted,
      minWidth: 38,
      textAlign: "right",
    },
    total: {
      fontFamily: theme.fonts.regular,
      fontSize: 12,
      color: theme.colors.textFaint,
      marginTop: 2,
    },
  });
}
