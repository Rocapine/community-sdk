---
"@rocapine/community-ui": minor
"@rocapine/community-core": minor
---

**community-ui (breaking).** The feed header is configured in three zones. `header`
takes `{ left?, center?, right?, background? }`, each zone a row of items: `"title"`,
`"profile"`, `"search"`, `"inbox"` or `{ logo, height?, width?, accessibilityLabel? }`.
The center zone stays centered; a logo and the title can sit side by side.
`DEFAULT_FEED_HEADER` is `{ left: ["profile"], center: ["title"], right: ["search", "inbox"] }`.

`renderAvatar` now knows whose avatar it draws and where: `AvatarRenderProps` gains
`official`, `handle`, `placement` (`post`, `comment`, `profile`, `header`, `composer`,
`reply`, `edit`) and `badges`. New colour `officialName` (defaults to `textPrimary`) for an
official account's name on posts, comments and its profile.

Migration:

- `headerLayout` is gone. `{ left: ["search"], title: { image: LOGO, position: "center", accessibilityLabel: "App" }, right: ["inbox", "profile"] }`
  becomes `header={{ left: ["search"], center: [{ logo: LOGO, width: 160, accessibilityLabel: "App" }], right: ["inbox", "profile"] }}`.
  A logo is 32 high and square unless you set `width` (the old title image was a 160 × 32
  box); `title: "left"` becomes `left: [..., "title"]`; `title: false` is an empty center.
- The old `header?: ReactNode` (a node above the row) is removed: put it above the screen.
- `FeedHeaderLayout`, `FeedHeaderButton`, `FeedHeaderTitle` and `DEFAULT_FEED_HEADER_LAYOUT`
  are replaced by `FeedHeaderConfig`, `FeedHeaderItem`, `FeedHeaderBackground` and
  `DEFAULT_FEED_HEADER`.
- A custom `renderAvatar` keeps working; it simply receives more props.

**community-core.** Exports the `MemberBadges` / `MemberBadgeData` types (filled by the
badges module in a later change).
