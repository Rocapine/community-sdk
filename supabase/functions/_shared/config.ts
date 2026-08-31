// Per-app copy used inside notifications, injected as function secrets so the
// same function code deploys unchanged to every app:
//
//   supabase secrets set COMMUNITY_FALLBACK_NAME="A member"
//   supabase secrets set COMMUNITY_APP_NAME="My App"
//   supabase secrets set COMMUNITY_REACTION_PUSH_TEXT="{name} sent you support"
//
// Defaults are deliberately neutral.

// Display name used when the acting user has no username yet
// ("<name>: ..." in comment pushes, "<name> liked your post").
export const FALLBACK_ACTOR_NAME = Deno.env.get("COMMUNITY_FALLBACK_NAME") ?? "Someone";

// Push title fallback for official broadcast posts whose author has no
// username (normally the official account's display name).
export const BROADCAST_FALLBACK_TITLE = Deno.env.get("COMMUNITY_APP_NAME") ?? "Community";

// notify-reaction's single-reactor push title template. `{name}` is
// substituted with the reactor's display name (or FALLBACK_ACTOR_NAME).
// Neutral default; an app with its own reaction semantics overrides this
// secret rather than the function code.
export const REACTION_PUSH_TEXT =
  Deno.env.get("COMMUNITY_REACTION_PUSH_TEXT") ?? "{name} is thinking of you";
