---
"@rocapine/community-core": patch
"@rocapine/community-ui": patch
---

**The online count can be plain text.** `modules.presence.appearance: "text"` shows the
header's online count as the green dot and "N online", always in full, with no pill
behind it; the dot pulses once on the first arrival (per JS runtime). The default stays
`"pill"`. Core exports `OnlineCountAppearance`.

**Header alignment.** A logo or the online count placed first in the feed header's left
zone now lines up with the first topic tab's label, and one placed last on the right with
the content edge, like the icons. A left logo moves 9pt inward.
