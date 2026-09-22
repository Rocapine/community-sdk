---
"@rocapine/community-ui": minor
---

- `ThreadSheet` gates the first comment behind `RulesSheet`, like `ComposerCard` does for posts (both source apps had this; it was lost in the extraction).
- Rules acceptance is now one shared in-memory flag (`useRulesAccepted`), so accepting the rules from any `RulesSheet` — including a host-mounted one — unlocks the composer and the comment box immediately, with a single `community_rules_accepted` event.
- CLDR plural categories: `makeT` picks `<key>.one/.few/.many/.other` via the exported `pluralCategory` (Polish few/many, French 0 → one), falling back to `.other`; the Polish catalog ships `.few` forms.
- Feed lists are de-duplicated by post id across pages (offset pagination on a live feed could repeat a row and trip `FlatList` keys).
- `NotificationInboxScreen.renderInboxRow` receives a third `{ unread }` argument so custom-kind rows can show the same unread state as built-in rows.
- README: peer dep floor, gate example that settles on every paywall path, `topInset`/`slots` in the screens table.
