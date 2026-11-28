# Imported history, account markers, bans that survive deletion, and dashboard brick 23

Status: draft 2026-11-28, waiting for Guillaume's review. Guillaume agreed to the four parts on
2026-11-28 and asked to do them now, before dashboard bricks 8 and 6. Calls marked "my call" are the
builder's choices for him to check.

## Why

Three SDK changes since 0.21 make the dashboard mislead, and one leaves a hole in moderation:

- **Imported history doesn't count.** A history import (Octopus → Unchaind, 19 Nov) creates
  placeholder profiles (`profiles.is_placeholder`) that hold the imported posts. Core `019` leaves
  everything they hold out of `admin_daily_metrics` and `admin_activity_breakdown`. Guillaume
  decided (2026-11-28) that imported history is the community's own content.
- **Merged profiles look like members.** With the accounts module, signing into an app account on a
  new phone merges that phone's anonymous profile into the account's profile. The merged profile
  stays as an empty row: it shows in Members and counts in `members_total` and new members.
- **Deleted accounts look like any member.** Deleting an account resets the profile (default name,
  no Amplitude or RevenueCat id, no badges) but keeps its posts; nothing tells the team it was
  deleted, and the member card loses its links.
- **Deleting an account escapes a ban.** A banned member who deletes their account and signs up
  again with the same app account gets a fresh, unbanned profile.

## Goals

1. Activity counts imported history like the community's own content.
2. Merged profiles are marked, so the dashboard hides them and no count includes them.
3. Deleted-account profiles are marked, so the dashboard says so; their content still counts.
4. A ban survives account deletion: the same app account comes back banned.
5. Dashboard brick 23: the member card shows the linked app account; merged profiles are hidden;
   deleted accounts are flagged.

## Non-goals

- Re-attributing imported posts to members once they claim their placeholder (the import tool's
  job, already handled by `octopus_import.merge_into`).
- Warning before a team account or an admin is merged away (accepted risk, decided 2026-11-28).
- Changing how merges or deletions work for the member; only markers are added.
- Any UI in the app.

## Anti-goals

- Touching `merge_profiles`: the messaging branch redefines it (`accounts/003_merge_hooks.sql`);
  this work must not conflict with it.
- Hiding a deleted account's content: it stays, and stays moderatable.
- Storing an app account's subject in clear anywhere new; a ban is kept on a hash.

## Decisions

### SDK: imported history in Activity (core `021`)

- `admin_daily_metrics` and `admin_activity_breakdown` count placeholders' posts, comments, likes,
  poll votes and reactions like any member's: only house accounts and merged profiles stay out.
- **A placeholder joins on its first contribution** (my call): its `created_at` is the import date
  (19 Nov for 893 profiles), which would show 893 new members that day. For new members, members
  total and returning contributors, a placeholder's join date is the date of its earliest post or
  comment (its `created_at` if it has none). The history then reads as if the community had been
  there all along.
- Merged profiles (below) are left out of every count; deleted-account profiles are counted as
  members up to their deletion and their content always counts (my call: they were real members).
- Same signatures and JSON shapes as today: the dashboard needs no change for this part.

### SDK: markers (accounts `003`)

- `profiles.merged_into uuid null references profiles(id)` and `profiles.account_deleted_at
timestamptz null`. Not client-writable (same grants as `is_placeholder`).
- `merged_into` is set by `account_link_and_merge` right after each `merge_profiles(p_main, x)`
  call, not inside `merge_profiles` (anti-goal).
- **Only merges from now on are marked** (my call): a profile merged before this migration can't be
  told apart from a real member who never wrote anything, so it is left as it is rather than
  guessed at. The dashboard hides only marked profiles, never a silent real member.
- `account_deleted_at` is set by `account_delete_profile`.
- **Migration numbering** (needs Guillaume): this is `accounts/003`, and the unreleased messaging
  branch's `accounts/003_merge_hooks.sql` becomes `004` when it rebases. The alternative (this
  becomes `004`) would make main depend on a file only the branch has.

### SDK: bans that survive deletion (accounts `003`)

- New table `account_bans (provider text, subject_hash text, banned_at, primary key (provider,
subject_hash))`, service role only. `subject_hash` is a sha256 of `provider:subject` computed in SQL (the session hash in
  `account_session_calls` is computed in TypeScript and can't be reused from SQL).
- `account_delete_profile`: if the profile is banned and still linked, record its (provider,
  subject hash) in `account_bans` before the link goes.
- `account_link_and_merge`: when the (provider, subject) being linked is in `account_bans`, the main
  profile is banned (`is_banned = true`) and a `moderation_actions` row says why (my call:
  `actor_email = 'account ban'`, note "banned account came back").
- Unbanning such a profile from the dashboard also deletes its `account_bans` row (dashboard calls
  a new service-role RPC `account_unban(profile)`, or the unban path does it — builder's choice).

### Dashboard: brick 23 "Accounts on the member card"

- **Member card:** when the accounts module is installed, a line "App account" with the provider
  and the subject (copyable, it's the host app's user id) and "linked since"; none when the
  profile has no link.
- **Merged profiles** (`merged_into` set) are left out of Members (every filter), search and
  counts, and their item views say "Merged into <name>" with a link if one is ever opened directly.
- **Deleted accounts:** a muted "Deleted account" chip next to the name (Members, member card,
  queue author summary), a filter "Deleted accounts", the card notice "This member deleted their
  account. Their posts stay." Ban and moderation still work on them.
- Every new column and table behind a probe: older schemas behave as today.

## Constraints

- No change to `merge_profiles`.
- SDK release then host migrations, as usual: SDK PR → release (Guillaume) → Unchaind PR copying
  the migrations → sandbox, then prod `db push` by Guillaume. Agents never write to prod; the
  sandbox only through migrations.
- Changesets for the SDK release; roadmap coverage rows and brick 23 updated in the same PR.

## Left to the builder

- The SQL of the redefined metrics (keep them readable; the 019 versions are the base).
- The back-fill decision details and the unban path for `account_bans`.
- Dashboard component structure and copy beyond the strings above.
