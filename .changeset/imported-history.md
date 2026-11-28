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
- Run `npx @rocapine/community upgrade` and `supabase db push`. Same function signatures and JSON
  shapes: the dashboard needs no change.
