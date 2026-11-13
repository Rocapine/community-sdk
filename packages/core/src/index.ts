export type {
  CommunityTopicDef,
  CommunityModules,
  HostStreak,
  CommunityHostAdapters,
  CommunityFeedConfig,
  CommunityConfig,
  CommunityDefaultName,
  ResolvedCommunityConfig,
} from "./config";
export {
  CommunityDisabledError,
  DEFAULT_NAME,
  DEFAULT_POST_MAX_LENGTH,
  resolveConfig,
  canAttach,
  isEventTopic,
  topicLive,
  STREAK_BADGES,
  presenceSettings,
} from "./config";
export type { PresenceSettings } from "./config";

export {
  PRESENCE_HEARTBEAT_MS,
  createOnlineBatcher,
  fetchMyPresenceVisible,
  fetchOnlineCount,
  fetchOnlineIds,
  setPresenceVisible,
  startPresenceHeartbeat,
  touchPresence,
} from "./presence";
export type { AppStateLike } from "./presence";

export {
  PRESENCE_KEY,
  PRESENCE_POLL_MS,
  isOnlineQueryOptions,
  onlineCountQueryOptions,
  presenceVisibilityMutationOptions,
  presenceVisibleQueryOptions,
  useIsOnline,
  useOnlineCount,
  usePresenceVisible,
  useSetPresenceVisible,
} from "./presence-hooks";
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
  MemberBadgeData,
  MemberBadges,
  PostAttachment,
  BadgePlacement,
  ThreadComment,
  PostImage,
  LocalImage,
  CommunityProfile,
  BlockedMember,
  StreakTier,
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
  mapBlockedMemberRow,
  streakBadgeData,
  streakDays,
  streakTier,
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
  fetchPost,
  countNewPosts,
  fetchProfile,
  fetchUserPosts,
  searchPosts,
  fetchThread,
  createPost,
  votePoll,
  createComment,
  moderateOne,
  setCommentLike,
  setLike,
  setReaction,
  setBadgeVisibility,
  fetchReactionSummaries,
  reportContent,
  blockUser,
  unblockUser,
  fetchBlockedMembers,
  isProfileUnavailable,
  deleteOwnPost,
  setPostPinned,
  countPinnedPosts,
  requestPostBroadcast,
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
  usePost,
  useProfile,
  useUserPosts,
  useMyUid,
  useNotificationPreferences,
  useUpdateProfile,
  useSetBadgeVisibility,
  useCreatePost,
  useCreateComment,
  useToggleCommentLike,
  useToggleLike,
  useVotePoll,
  useReactToPost,
  useReport,
  useBlockUser,
  useUnblockUser,
  useBlockedMembers,
  useDeleteContent,
  usePinPost,
  isOptimistic,
} from "./hooks";

export {
  fetchInbox,
  isUnread,
  localizeExcerpts,
  markInboxItemRead,
  markInboxSeen,
  unreadCount,
} from "./inbox-service";
export type { InboxItem, InboxState } from "./inbox-service";

export {
  useNotificationInbox,
  useUnreadNotificationCount,
  useMarkInboxSeen,
  useMarkInboxItemRead,
  useMarkPostNotificationsRead,
} from "./inbox-hooks";

export { REQUIRED_SCHEMA_VERSION } from "./schema-check";
