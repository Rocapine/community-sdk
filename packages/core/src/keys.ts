// React Query keys (internal, not exported from the package). Every full key
// ends with the reader locale ("src" = originals) so switching locale never
// serves another locale's cached translations; the *_KEY prefixes stay
// prefixes of the full keys so setQueriesData/invalidateQueries match them all.

export const FEED_KEY = ["community", "feed"] as const;
export const feedKey = (topic?: string, locale?: string | null) =>
  [...FEED_KEY, topic ?? "all", locale ?? "src"] as const;
export const threadKey = (postId: string, locale?: string | null) =>
  ["community", "thread", postId, locale ?? "src"] as const;
export const USER_POSTS_KEY = ["community", "userPosts"] as const;
export const userPostsKey = (userId: string, locale?: string | null) =>
  [...USER_POSTS_KEY, userId, locale ?? "src"] as const;
export const SEARCH_KEY = ["community", "search"] as const;
export const searchKey = (cleaned: string, locale?: string | null) =>
  [...SEARCH_KEY, cleaned, locale ?? "src"] as const;
