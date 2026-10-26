# Default names, host name seeding, editable name + handle

Decided with Guillaume on 2026-10-26.

## Goal

Every community profile always has a display name and a handle. A new user is
"User 4821" / `@user-4821` (or the app's own prefix: "Frère 4821" /
`@brother-4821` on Unchaind). An app may share its own user name with the
community; when it does, the profile starts from that name. The user can then
edit their photo, display name and handle from the community profile.

## Behaviour

1. **Default name, assigned at first launch.** The app configures
   `defaultName: { label: string | (locale) => string, handle: string }`
   (SDK default: `{ label: "User", handle: "user" }`). On every launch the client
   calls `assign_default_profile(label(hostLocale), handle)` once; it is
   idempotent. The server draws the digits: handle `<handle>-<digits>` (unique,
   4 digits, widening on collision as `generate_handle` already does), name
   `<label> <digits>` with the same digits. Stored as `default_username` /
   `default_handle`; `username` / `handle` are filled only when still null.
   The label is resolved in the **user's** language and never re-translated
   (a name is an identity, not content).
2. **Sharing the app's name is the app's choice.** `host.getDisplayName()`
   returns the name (Eve, Nightward) or `null` (Unchaind). No new option.
3. **The app's name seeds, the user wins.** `syncProfileFromHost` keeps writing
   the app's name (and follows its changes) until the user edits their name in
   the community (`username_set_by_user`); from then on a client write of
   `username` is ignored server-side. Same for the handle: while
   `handle_set_by_user` is false, a host name change regenerates the handle
   from it (falling back to the app's handle prefix when the name has no
   usable letters).
4. **Editing (update-profile).** Display name: 2-24 chars, synchronous
   moderation, must not contain the app name (`COMMUNITY_APP_NAME`,
   accent/case-insensitive) → `reserved_name`. Handle: `[a-z0-9-]{3,20}`,
   moderation, reserved (`admin`, `support`, `official`, `team`, `moderator`,
   or containing the app name) → `reserved_handle`; taken → `handle_taken` with
   a free `suggestion` (`<base≤15>-<digits>`), which the UI offers in one tap.
   Each successful edit sets the matching `*_set_by_user`.
5. **Moderation sweep.** A blanked host name falls back to `default_username`
   (and the handle to `default_handle` when the user never picked one), instead
   of null. Host names containing the app name are treated as flagged.
6. **Account deletion.** `reset_profile_identity()` puts the default name and
   handle back, clears bio, avatar and both `*_set_by_user`.
7. **UI.** Edit profile: photo, display name, "Identifiant (@)", bio, each saved
   on its own. Handle availability is checked on save only. Optimistic posts
   and comments use the own community profile's name.
8. **Legacy rows** (no default yet, e.g. a user who has not relaunched): the UI
   shows the resolved label alone ("Frère").

## Not doing

Banned display-name list beyond the app name, live handle availability,
handle change cooldown, render-time translation of default names, a SQL
backfill (the client assigns defaults at next launch).

## API changes

- `CommunityConfig.anonymousAuthorFallback` → `defaultName` (optional). Breaking.
- `resetProfileIdentity()` exported from core for account deletion.
- Migration `core/009_default_names.sql`; schema version stays 1 (an older backend
  just lacks the RPCs, which the client ignores).
