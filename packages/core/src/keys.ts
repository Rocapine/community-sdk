// React Query keys (internal, not exported from the package). Every full key
// ends with the reader locale ("src" = originals) so switching locale never
// serves another locale's cached translations; the *_KEY prefixes stay
// prefixes of the full keys so setQueriesData/invalidateQueries match them all.

export const FEED_KEY = ["community", "feed"] as const;
export const feedKey = (topic?: string, locale?: string | null) =>
  [...FEED_KEY, topic ?? "all", locale ?? "src"] as const;
// One post fetched on its own (a thread opened from a notification, its post in
// no loaded list). Under FEED_KEY, as a one-page list, so every feed-wide sweep
// (likes, reactions, votes, comment counts, deletes) keeps it current too.
export const singlePostKey = (postId: string, locale?: string | null) =>
  [...FEED_KEY, "post", postId, locale ?? "src"] as const;
export const threadKey = (postId: string, locale?: string | null) =>
  ["community", "thread", postId, locale ?? "src"] as const;
export const USER_POSTS_KEY = ["community", "userPosts"] as const;
export const userPostsKey = (userId: string, locale?: string | null) =>
  [...USER_POSTS_KEY, userId, locale ?? "src"] as const;
export const SEARCH_KEY = ["community", "search"] as const;
export const searchKey = (cleaned: string, locale?: string | null) =>
  [...SEARCH_KEY, cleaned, locale ?? "src"] as const;

// Messaging (groups module). Keys holding translated text end with the locale too.
export const CONVERSATIONS_KEY = ["community", "conversations"] as const;
export const MESSAGES_KEY = ["community", "messages"] as const;
export const messagesKey = (conversationId: string, locale?: string | null) =>
  [...MESSAGES_KEY, conversationId, locale ?? "src"] as const;
export const GROUPS_KEY = ["community", "groups"] as const;
export const GROUPS_SEARCH_KEY = [...GROUPS_KEY, "search"] as const;
export const groupKey = (id: string, locale?: string | null) =>
  [...GROUPS_KEY, "group", id, locale ?? "src"] as const;
export const groupMembersKey = (id: string) => [...GROUPS_KEY, "members", id] as const;
export const UNREAD_MESSAGES_KEY = ["community", "unreadMessages"] as const;
// DMs (dms module).
export const DMS_KEY = ["community", "dms"] as const;
export const DM_REQUESTS_KEY = [...DMS_KEY, "requests"] as const;
export const dmFlagKey = (userId: string) => [...DMS_KEY, "flags", userId] as const;
export const peerReadKey = (conversationId: string) =>
  [...DMS_KEY, "peerRead", conversationId] as const;
export const memberSearchKey = (query: string) => [...DMS_KEY, "members", query] as const;
