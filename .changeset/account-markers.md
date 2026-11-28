---
"@rocapine/community": patch
---

**Accounts: merged and deleted profiles are marked; a ban survives account deletion.** `accounts/003_markers_and_bans.sql` (no app change, needs core `021`):

- `account_link_and_merge` sets `merged_into` on each profile it merges (and on any profile already
  merged into one of them), so the dashboard leaves merged profiles out of every count and list.
- `account_delete_profile` stamps `account_deleted_at`: a deleted account counts as a member until
  then, its posts always count.
- Deleting a banned account no longer escapes the ban: `account_bans` keeps a sha256 of the
  account's `provider:subject` (never the subject itself), and the next profile that account links
  is banned, with a `ban` moderation action by `account ban`. `account_unban(profile)` (service
  role) lifts it; the dashboard's unban calls it.
- Run `npx @rocapine/community upgrade` and `supabase db push`. `merge_profiles` is unchanged.
