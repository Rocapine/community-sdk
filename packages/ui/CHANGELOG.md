# @rocapine/community-ui

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
