---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
---

Restore what the Eve's Rhythm community did before the SDK migration:

- Floating "write a post" bar once the inline composer scrolls away (tap: scroll up + focus, or the rules sheet while locked; accepting the rules focuses the composer). New `compose` icon role.
- A post that fails to send shows the network notice and puts the draft back (`ComposerCard` `onPublishFailed`); a failed comment draft comes back too.
- A rejected/failed comment closes the thread and shows its notice over the screen, instead of behind the thread sheet.
- Optimistic posts/comments carry your own uid/avatar (tap → your profile, not an empty-id route); new `isOptimistic(item)` helper in core for id-keyed actions.
- Relative timestamps refresh every minute (`useNow`).
- `CommunityFeedScreen` `isFocused` prop: new-post polling stops while the screen is hidden (tabs).
- `onOpenProfile(userId, source)` + `ProfileScreen` `source` prop: `profileOpened` reports `"comment"` again.
- Comment field shows your avatar.
- Avatars resized to 512px JPEG before upload when the optional `expo-image-manipulator` peer is installed (`resizeAvatar` exported).
- Haptic on poll votes.
- Inbox: re-marks seen when a newer item lands mid-visit; `onOpenCommunity` for rows without a post; authorless announcements read `inbox.newsFromTeam`.
- Slots get `ctx.presentModal(open)`: inside `ThreadSheet` it closes the sheet before opening the host's Modal (opening one on top froze every touch on iOS).
