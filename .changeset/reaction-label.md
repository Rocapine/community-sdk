---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
---

Reactions: `modules.reaction` takes an optional `label` shown next to the icon (e.g.
`{ key: "yum", label: "Yum" }`), coloured `colors.reaction` when active. `PostSlotContext`
gains `reaction: { active, count, toggle }`, so a `renderReactionButton` can draw its own
button without re-implementing the toggle (`toggle` honours `onPressReaction`).
