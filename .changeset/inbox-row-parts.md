---
"@rocapine/community-ui": minor
---

`renderInboxRow`'s third argument grows from `{ unread }` to `{ unread, open, parts }`:
`open()` does what tapping the built-in row does (opens the post, marks it read), and
`parts` (`icon`, `title`, `excerpt`, `timeLabel`) are the built-in row's pieces, so a host
can draw a row of its own design that still opens the post. `InboxRowMeta` and
`InboxRowParts` are exported. Existing renderers keep working.
