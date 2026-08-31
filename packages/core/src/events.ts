import type { ResolvedCommunityConfig } from "./config";

// ⭐ Analytics seam — community code emits every product event through
// emitEvent() and nothing else. The host wires cfg.host.onEvent to its own
// tracking plan; left as a no-op by default so the community works before
// analytics are wired.
export const COMMUNITY_EVENTS = {
  opened: "community_opened",
  rulesAccepted: "community_rules_accepted",
  postPublished: "community_post_published",
  pollVoted: "community_poll_voted",
  threadOpened: "community_thread_opened",
  postLiked: "community_post_liked",
  commentPublished: "community_comment_published",
  profileOpened: "community_profile_opened",
  profileUpdated: "community_profile_updated",
  reactionAdded: "community_reaction_added",
  userReported: "user_reported",
  userBlocked: "user_blocked",
  contentDeleted: "content_deleted",
  inboxOpened: "notification_center_opened",
} as const;

export type CommunityEventName = (typeof COMMUNITY_EVENTS)[keyof typeof COMMUNITY_EVENTS];

/** Forwards to the host's onEvent adapter. Never throws — a bad adapter must never break the UI. */
export function emitEvent(
  cfg: ResolvedCommunityConfig,
  name: CommunityEventName,
  props?: Record<string, unknown>,
): void {
  try {
    cfg.host.onEvent(name, props ?? {});
  } catch {
    // swallow — analytics must never break the app
  }
}
