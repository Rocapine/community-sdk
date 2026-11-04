---
"@rocapine/community-ui": minor
---

`theme.typography`: nine named text roles (`display`, `title`, `heading`, `body`,
`bodySmall`, `label`, `meta`, `caption`, `input`), each a complete text style derived
from `fonts` and `fontWeights`. A host overrides one role field by field, e.g. a header
title font of its own: `typography: { title: { fontFamily: "Orbitron-Bold" } }`.

Every component now draws with a role instead of a literal size. The 14 sizes used
before snap to the role scale; most text moves by 0.5 pt at most. A few move by 1 pt: the
inbox title (19 → 20), the composer's Cancel (16 → 15), and some 11 pt labels (→ 12).

Migration: nothing to do. A theme that only sets `fonts` renders the same families as
before.
