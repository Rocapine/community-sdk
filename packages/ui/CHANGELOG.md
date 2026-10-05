# @rocapine/community-ui

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

### Patch Changes

- Updated dependencies [36351ba]
  - @rocapine/community-core@0.5.0

## 0.4.2

### Patch Changes

- 3a7309d: Tapping an author in a thread closes the thread sheet before opening their profile, so the profile no longer opens underneath the sheet.

## 0.4.0

### Minor Changes

- cd33dd7: Sheets (thread, report, rules, profile edit) are rebuilt on `@gorhom/bottom-sheet`: swipe down from the handle (or from content scrolled to the top) to close, and in a thread the comment input stays pinned right above the keyboard while the whole thread, from the post to the last comment, stays scrollable. New peer dependencies: `@gorhom/bottom-sheet >=5.1.0`, `react-native-gesture-handler >=2.16.1`, `react-native-safe-area-context >=4.10.0` (no provider needed in the host app).

### Patch Changes

- c66022a: Switching a post, comment or poll label between its original and its translation (or expanding a post) now animates the height change instead of reserving the taller version's height: no empty space under the shorter version, and the rest of the card and the list glide with it (Reanimated, honours Reduce Motion).

## 0.3.4

### Patch Changes

- 7d9d81c: Switching a post or comment between its original and its translation no longer shifts the layout: the body is clamped from its first frame (no unclamped flash while re-measuring) and reserves the height of the taller version. Invisible measuring copies are kept out of the accessibility label.

## 0.3.0

### Minor Changes

- 4f83d20: Posts, comments and poll labels display their reader-locale translation with a per-item "Translated from X · See original" toggle; `displayText`/`translationLine` helpers; `translation.*` and `language.*` catalogue keys in 9 locales.

### Patch Changes

- Updated dependencies [4f83d20]
  - @rocapine/community-core@0.3.0

## 0.2.0

### Minor Changes

- af11ccc: Add optional pre-submit gate hooks: `ComposerCard`'s `beforeSubmit` and `ThreadSheet`'s `beforeSubmitComment` (forwarded by `CommunityFeedScreen` as `beforeSubmitPost` / `beforeSubmitComment`) let a host intercept a post or comment with an async check — e.g. a paywall that resolves once the user is entitled — before the SDK's own mutation runs. Both props are optional and default-inert: resolving `false` (or a rejection) aborts the submit silently and keeps the draft, and absent props are byte-identical to prior behavior.
- fadaed0: ProfileScreen: add optional `topInset` prop so a host mounting it as a full-screen route can push its own back button below the status bar / notch (the SDK keeps no react-native-safe-area-context dependency; the host feeds `useSafeAreaInsets().top`).
- 96668d3: - `ThreadSheet` gates the first comment behind `RulesSheet`, like `ComposerCard` does for posts (both source apps had this; it was lost in the extraction).
  - Rules acceptance is now one shared in-memory flag (`useRulesAccepted`), so accepting the rules from any `RulesSheet` — including a host-mounted one — unlocks the composer and the comment box immediately, with a single `community_rules_accepted` event.
  - CLDR plural categories: `makeT` picks `<key>.one/.few/.many/.other` via the exported `pluralCategory` (Polish few/many, French 0 → one), falling back to `.other`; the Polish catalog ships `.few` forms.
  - Feed lists are de-duplicated by post id across pages (offset pagination on a live feed could repeat a row and trip `FlatList` keys).
  - `NotificationInboxScreen.renderInboxRow` receives a third `{ unread }` argument so custom-kind rows can show the same unread state as built-in rows.
  - README: peer dep floor, gate example that settles on every paywall path, `topInset`/`slots` in the screens table.

### Patch Changes

- Updated dependencies [092a697]
  - @rocapine/community-core@0.2.0

## 0.1.0

### Minor Changes

- initial public release

### Patch Changes

- Updated dependencies
  - @rocapine/community-core@0.1.0
