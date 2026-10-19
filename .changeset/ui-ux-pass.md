---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

UI/UX pass.

core: the secondary reaction can be withdrawn — `useReactToPost().mutate({ postId, on: false })`, `setReaction(cfg, postId, on)`, `applyReaction(post, on)`.
ui: every tappable element is a `PressableScale` (slight scale + dim on press, haptics where they matter: light on UI, medium on like/reaction/publish/send); the default reaction button toggles; fixed-width stats with tabular digits; the comment button opens the thread with the reply field focused (`ThreadSheet` `focusComment`, `CommunityPost` `onPressComment`); filter chips scroll edge to edge; 44pt header icons; search bar and chips share one height; no composer while searching, plus a clear button; room under the last post for the floating compose bar; the composer drops its topic chips — it grows while composing and shows a topic select (defaults to the browsed topic); bold Publish label and a visible disabled state; four radii, concentric nesting. Theme: `colors.reaction`, `fontWeights`.
cli: ships `reaction/003_retract.sql` (delete policy on `post_reactions`) — run `community upgrade` then `supabase db push`.
