---
"@rocapine/community": patch
---

**Accounts: merged and deleted profiles are marked; a ban survives account deletion.** `accounts/003_markers_and_bans.sql` (no app change, needs core `021`):

- `account_link_and_merge` sets `merged_into` on each profile it merges (and on any profile already
  merged into one of them), so the dashboard leaves merged profiles out of every count and list.
  A profile adopted again as the account's profile loses both markers.
- `account_delete_profile` stamps `account_deleted_at`: a deleted account counts as a member until
  then, its posts always count.
- Deleting a banned account no longer escapes the ban: `account_bans` keeps a sha256 of the
  account's `provider:subject` (never the subject itself), and the next profile that account links
  (a new link only: a later sign-in never undoes an unban) is banned, with a `ban` moderation action by `account ban`. `account_unban(profile)` (service
  role) lifts it; the dashboard's unban calls it. Deleting a profile that is not banned drops its
  account's leftover rows, so a ban lifted without `account_unban` doesn't come back.
- Run `npx @rocapine/community upgrade` and `supabase db push`. `merge_profiles` is unchanged.
- Release order: deploy the dashboard's brick 23 before accounts `003` reaches a host database (its
  unban calls `account_unban`; a ban lifted without it is still dropped when the profile is deleted
  again). A host that imported history with an importer that empties the placeholders members claim
  must set `merged_into` on those placeholders in the same push, right after core `021` (a host
  migration ordered after it), or they count as members.
