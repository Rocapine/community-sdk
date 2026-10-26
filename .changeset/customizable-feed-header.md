---
"@rocapine/community-ui": patch
---

`CommunityFeedScreen` takes a `headerLayout` prop: pick the header buttons on each side (`profile`, `search`, `inbox`) and show the "Community" title on the left, in the center, or not at all. The new default (`DEFAULT_FEED_HEADER_LAYOUT`) is the user's avatar on the left (opens their own profile), the title centered, and search then inbox on the right — apps that kept the old default header now get this one. The header buttons get the same press scale as the rest of the community. New string `a11y.myProfile` in all 13 catalogs.
