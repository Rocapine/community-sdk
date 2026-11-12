---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**A block now works both ways, and can be undone.** Until now, when A blocked B, A stopped
seeing B but B still saw A, and could comment and reply under A's posts: everyone saw it
except A, who could not report it.

- `core/016_mutual_blocks.sql`: neither member sees the other's posts, comments, likes or
  profile, and neither can comment, reply or like on the other's content. A comment or a like
  now needs a post the member can read (no more commenting a hidden post by id). Admins are
  never hidden by a block and can't be blocked. `blocked_member_ids()` is the one rule; reuse
  it for anything that shows one member to another (online presence included).
  `list_blocked_members()` lists whom I blocked.
- `inbox/004_mutual_blocks.sql`, `reaction/004_mutual_blocks.sql`: the notification center and
  the reaction summary hide members blocked either way, past items included; an unblock
  brings them back. The likes, comments and reactions pushes and the icon badge follow the
  same rule.
- Core: `unblockUser`, `fetchBlockedMembers`, `isProfileUnavailable`, hooks `useUnblockUser`,
  `useBlockedMembers`, event `userUnblocked` (`user_unblocked`).
- UI: `BlockedMembersScreen` (mount it from your settings); a blocked profile shows "This
  profile isn't available", with Unblock for the member who blocked; a harassment report offers
  to block the author; no Block item on an admin's posts; the block confirmation says it works
  both ways. All 13 locales.

Migration: `npx @rocapine/community upgrade`, `supabase db push`, redeploy `notify-comment`,
`notify-like` and `notify-reaction`. Installed app versions get the mutual block without an
update; on them a blocked profile shows their usual error state.
