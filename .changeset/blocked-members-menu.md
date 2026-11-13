---
"@rocapine/community-ui": minor
---

Your blocked members are one tap away from your own profile. `ProfileScreen` takes `onOpenBlockedMembers`: when given, your own profile gets the "…" menu with a "Blocked members" item that calls it, and the host opens `BlockedMembersScreen`. Without it, your own profile has no menu, as before.
