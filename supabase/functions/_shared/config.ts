// Per-app copy injected as function secrets so the same function code
// deploys unchanged to every app. Push copy (actor fallback name, like /
// comment / reaction titles) lives in _shared/copy.ts (COMMUNITY_PUSH_COPY).

// Push title fallback for official broadcast posts whose author has no
// username (normally the official account's display name).
export const BROADCAST_FALLBACK_TITLE = Deno.env.get("COMMUNITY_APP_NAME") ?? "Community";
