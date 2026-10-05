# @rocapine/community-core

## 0.5.0

### Minor Changes

- 36351ba: Restore what the Eve's Rhythm community did before the SDK migration:

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

## 0.3.0

### Minor Changes

- 4f83d20: Translation module: `modules.translation`, `readerLocale`, reader-locale translation embeds in feed/thread selects (only when the module is on), `translation` fields on `FeedPost`/`ThreadComment` and `translatedLabel` on poll options (`text` stays the original), inbox excerpts in the reader locale, `community_translation_toggled` event.

## 0.2.0

### Minor Changes

- 092a697: Fix: the posts select embedded `poll_options(...)` regardless of `modules.polls`, so on a backend installed without the polls module (no `poll_options` table) every feed / user-posts / search query failed with PostgREST `PGRST200` and the feed rendered "unreachable". The embed is now added only when `modules.polls` is on (`buildFeedSelect(extraPostColumns, polls)`), and `mapPostRow`/`buildPoll` tolerate a missing `poll_options` field. Also: `useToggleLike` now applies its optimistic update to the user-posts and search caches too (same sweep as votes/reactions), and `useDeleteContent` invalidates them.

## 0.1.0

### Minor Changes

- initial public release
