export type {
  CommunityTopicDef,
  CommunityModules,
  CommunityHostAdapters,
  CommunityConfig,
  ResolvedCommunityConfig,
} from "./config";
export { CommunityDisabledError, resolveConfig } from "./config";
export { CommunityProvider, useCommunityConfig } from "./provider";

export type {
  PostRow,
  PollOptionRow,
  CommentRow,
  ProfileRow,
  PollOption,
  FeedPoll,
  PollData,
  ReactionData,
  FeedPost,
  ThreadComment,
  CommunityProfile,
} from "./models";
export {
  FEED_PAGE_SIZE,
  POST_MAX_LENGTH,
  COMMENT_MAX_LENGTH,
  POLL_MIN_OPTIONS,
  POLL_MAX_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  EMPTY_POLL_DATA,
  EMPTY_REACTION_DATA,
  displayName,
  normalizeTopic,
  mapProfileRow,
  buildPoll,
  pollPercent,
  mapPostRow,
  applyPollVote,
  applyReaction,
  mapCommentRow,
  newPostsLabel,
  newestCreatedAt,
} from "./models";

export { timeAgo } from "./time";

export { COMMUNITY_EVENTS, emitEvent } from "./events";
export type { CommunityEventName } from "./events";

export { ensureIdentity, resetIdentity, syncProfileFromHost } from "./identity";

export {
  fetchFeedPage,
  countNewPosts,
  fetchProfile,
  fetchUserPosts,
  searchPosts,
  fetchThread,
  createPost,
  votePoll,
  createComment,
  moderateOne,
  setLike,
  setReaction,
  fetchReactionSummaries,
  reportContent,
  blockUser,
  deleteOwnPost,
  deleteOwnComment,
  updateProfile,
  uploadAvatar,
} from "./service";
export type {
  ModerationVerdict,
  CreatePostInput,
  ReportReason,
  ReportInput,
  UpdateProfileInput,
  UpdateProfileResult,
} from "./service";

export {
  useCommunityFeed,
  useSearchPosts,
  useNewPostsCount,
  useCommunityUnseenCount,
  useThread,
  useProfile,
  useUserPosts,
  useMyUid,
  useUpdateProfile,
  useCreatePost,
  useCreateComment,
  useToggleLike,
  useVotePoll,
  useReactToPost,
  useReport,
  useBlockUser,
  useDeleteContent,
} from "./hooks";

export { fetchInbox, markInboxSeen, unreadCount } from "./inbox-service";
export type { InboxItem, InboxState } from "./inbox-service";

export { useNotificationInbox, useUnreadNotificationCount, useMarkInboxSeen } from "./inbox-hooks";
