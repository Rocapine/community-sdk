---
"@rocapine/community-ui": patch
---

Edit profile polish: centered layout, a pencil badge on the avatar opens the photo library, and one "Save" button at the bottom saves every changed field (disabled until something changed; closes the sheet on success). Tapping outside a field closes the keyboard, and a field the keyboard would cover scrolls into view. `SheetScrollView` accepts a `scrollRef`.
