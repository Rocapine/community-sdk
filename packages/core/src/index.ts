export type {
  CommunityTopicDef,
  CommunityModules,
  CommunityHostAdapters,
  CommunityFeedConfig,
  CommunityConfig,
  CommunityDefaultName,
  ResolvedCommunityConfig,
} from "./config";
export { CommunityDisabledError, DEFAULT_NAME, resolveConfig } from "./config";
export { readerLocale, languageOf } from "./locale";
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
  PostImage,
  LocalImage,
  CommunityProfile,
  TranslationInfo,
  TranslationRowEmbed,
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
  mapImage,
  pollPercent,
  mapPostRow,
  applyPollVote,
  applyReaction,
  mapCommentRow,
  newPostsLabel,
  newestCreatedAt,
} from "./models";

export type { TimeAgoParts } from "./time";
export { timeAgo, timeAgoParts } from "./time";

export { COMMUNITY_EVENTS, emitEvent } from "./events";
export type { CommunityEventName } from "./events";

export {
  ensureIdentity,
  resetIdentity,
  resetProfileIdentity,
  syncProfileFromHost,
} from "./identity";

export {
  buildFeedSelect,
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
  fetchNotificationPreferences,
  setNotificationPreference,
  NOTIFICATION_PREFERENCE_KEYS,
  uploadAvatar,
  uploadPostImage,
  POST_IMAGES_BUCKET,
} from "./service";
export type {
  ModerationVerdict,
  CreatePostInput,
  UploadedImage,
  ReportReason,
  ReportInput,
  UpdateProfileInput,
  UpdateProfileResult,
  NotificationPreferenceKey,
  NotificationPreferences,
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
  useNotificationPreferences,
  useUpdateProfile,
  useCreatePost,
  useCreateComment,
  useToggleLike,
  useVotePoll,
  useReactToPost,
  useReport,
  useBlockUser,
  useDeleteContent,
  isOptimistic,
} from "./hooks";

export { fetchInbox, localizeExcerpts, markInboxSeen, unreadCount } from "./inbox-service";
export type { InboxItem, InboxState } from "./inbox-service";

export { useNotificationInbox, useUnreadNotificationCount, useMarkInboxSeen } from "./inbox-hooks";

export { REQUIRED_SCHEMA_VERSION } from "./schema-check";
