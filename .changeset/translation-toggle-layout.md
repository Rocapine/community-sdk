---
"@rocapine/community-ui": patch
---

Switching a post or comment between its original and its translation no longer shifts the layout: the body is clamped from its first frame (no unclamped flash while re-measuring) and reserves the height of the taller version. Invisible measuring copies are kept out of the accessibility label.
