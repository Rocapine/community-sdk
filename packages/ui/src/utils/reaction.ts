// The reaction button's state and label, kept pure for tests.
import type { CommunityModules, FeedPost } from "@rocapine/community-core";

export function reactionState(post: Pick<FeedPost, "hasReacted" | "reactionCount">): {
  active: boolean;
  count: number;
} {
  return { active: post.hasReacted, count: post.reactionCount };
}

/** The word shown next to the reaction icon ("Yum"), or null for the icon alone. */
export function reactionLabel(reaction: CommunityModules["reaction"]): string | null {
  return (reaction && reaction.label?.trim()) || null;
}
