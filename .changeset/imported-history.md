---
"@rocapine/community": patch
---

**Imported history counts in the dashboard's Activity.** `core/021_imported_history.sql` (no app change):

- Placeholder profiles (a history import) now count like any member: their posts, comments, likes,
  poll votes and reactions show in Activity, and they count as contributors and active members.
  Expect higher numbers on apps that imported history.
- A placeholder joins on its first post or comment (its creation date if it has none), not on the
  import date, so new members and members total read as if the community had been there all along.
- Two markers on `profiles`, not client-writable: `merged_into` (a profile merged into another by
  the accounts module) and `account_deleted_at`. A merged profile is in no count; a deleted account
  counts as a member until its deletion and its content always counts. They stay empty until the
  accounts module sets them.
- Moderation's team actions leave out the accounts module's automatic bans (`account ban`).
- Indexes on `posts (author_id, created_at)`, `comments (author_id, created_at)` and
  `profiles (merged_into)`: a placeholder's join date is an index lookup.
  On a large production database, build the two author indexes beforehand with `create index concurrently if not exists` (and check they are valid), or push at low traffic with a `lock_timeout`: the file runs in one transaction.
- Run `npx @rocapine/community upgrade` and `supabase db push`. Same function signatures and JSON
  shapes: the dashboard needs no change.
- Release order: deploy the dashboard's brick 23 before accounts `003` reaches a host database (its
  unban calls `account_unban`; a ban lifted without it is still dropped when the profile is deleted
  again). A host that imported history with an importer that empties the placeholders members claim
  must set `merged_into` on those placeholders in the same push, right after core `021` (a host
  migration ordered after it), or they count as members.
