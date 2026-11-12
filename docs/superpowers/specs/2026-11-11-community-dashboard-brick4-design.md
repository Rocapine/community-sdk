# Community dashboard brick 4 — Team accounts and composer — design

Date: 2026-11-11. Status: approved 2026-11-11. Roadmap: [docs/dashboard-roadmap.md](../../dashboard-roadmap.md)
(brick 4). Builds on the V1 design ([2026-11-10-community-dashboard-v1-design.md](2026-11-10-community-dashboard-v1-design.md)),
whose constraints, UI principles, community registry, identity and deploy all still apply.
Mockups: `.superpowers/brainstorm/53205-1794425101/content/brick4-v2.html` (validated, minus two
hint lines removed below).

## Why

The team seeds and animates the community with its own accounts: an "Unchaind" admin account for
app news, and the 8 "Team" accounts created on phones at launch to liven up the feed. Today posting
as one of them means holding the phone that created it. Brick 4 lets anyone on the team create
these accounts and publish as any of them from the dashboard, and keep posts as shared drafts.

## Goals

- Create a team account from the dashboard: photo, name, bio, admin or not; an admin account can
  choose its handle.
- Edit any team account (the 8 existing ones included) the same way.
- Write a post as any team account: topic, text, image, poll, Bible verse; notify everyone; pin;
  publish now.
- Keep several posts as drafts, shared by the whole team on any device, while using the rest of
  the dashboard.

## Non-goals (this brick)

- Comments and replies as a team account: brick 6 (feed explorer), where the thread is.
- Scheduling a post for later: brick 7, right after this one. Brick 4 builds the draft storage so
  brick 7 only adds a date, the cron and the list/calendar (see "Drafts" below).
- Showing a verse's text in the dashboard: the admin types the reference; the reader's app draws
  the card. Revisit later if needed.
- Deleting a team account, or turning a team account back into a normal member.
- Editing or deleting a published post (brick 6).

## Anti-goals

- A page per feature. Team accounts live in Members; the composer floats over every screen.
- Account "kinds" (brand / persona / seed). Decided against on 2026-11-11: every team account is
  the same (`is_house = true`); the only difference is the Admin switch (`is_admin`).
- Treating accounts created on a phone differently from accounts created in the dashboard.
- Losing a draft: closing a composer window never deletes it.

## Decisions taken in brainstorming (2026-11-11)

1. **Team accounts are all equal.** A team account is a profile with `is_house = true`. The 8
   existing ones (anonymous auth users from phones, `is_admin = false`) are team accounts like any
   other. The Admin switch gives the admin seal and the admin powers (admin-only topics, notify
   everyone, pin), as in the app since SDK 0.15.
2. **Dashboard-only accounts.** An account created in the dashboard has no email and no way to log
   in to the app. (An account made on a phone may still be signed in on that phone; nothing to do
   about it.)
3. **Handles.** An admin account's handle is editable, pre-filled from the name with no numeric
   suffix (`Pastor James` → `@pastorjames`), checked for availability as you type. A non-admin
   account gets a handle like a member's (`@pastorjames-4821`), made by the SDK trigger. Checked
   in the SDK: `profiles` keeps a handle that is given explicitly and only generates one when it
   is null (core/009), so this needs no SDK change.
4. **Attachments.** Unchaind installs the attachments module (SDK 0.15, Unchaind #219) with one
   type, `verse`, id `book.chapter.verse[-verseEnd]` (e.g. `43.3.16`, `50.4.6-7`). The admin types
   a reference ("phil 4:6-7", "Jean 3:16"); the dashboard parses it in the app's languages and
   shows the canonical reference ("Philippians 4:6-7 ✓") or an error.
5. **Drafts are shared**, stored in the community's own database, readable and editable by anyone
   on the team from any device.
6. **Publishing skips AI moderation**: the post goes out visible at once, and is logged.

## Team accounts (in Members)

### Layout (mockup section 1)

- Members already has the "Team accounts" filter. Its header gets a **"+ New team account"**
  button (shown whatever the filter; it switches the filter to Team accounts).
- The form opens in the **side panel** members already use. While creating, a placeholder row
  "not created yet" sits selected at the top of the list.
- Fields: photo (upload; square, shown round), **Name** (required), **Bio** (optional),
  **Admin** switch with one line of explanation, and, when Admin is on, **Handle** (`@` prefix,
  "✓ available" / "taken" inline). No other hint text under the fields (removed on request).
- Buttons: Cancel, **Create account**.
- Selecting an existing team account opens the usual member panel (stats, links, tabs) with an
  **Edit** action that turns the top of the panel into the same form, pre-filled; and a
  **"Write a post as …"** action that opens the composer with that account chosen.

### Behaviour

- Create, server side (Worker, service key): create an auth user that cannot log in, let the
  `handle_new_user` trigger create the profile, then update the profile with `username`, `bio`,
  `avatar_url`, `is_house = true`, `is_admin`, and `handle` when Admin is on (else leave it null so
  the trigger generates it from the name). How the auth user is created is left to the builder
  (Admin API user with no password and no usable email, or an anonymous sign-up); the requirement
  is that nobody can sign in as it.
- Photo: re-encoded to JPEG in the browser (≤ 1 MB, square crop, EXIF stripped, as the app does),
  uploaded to the `avatars` bucket at `{uid}/{timestamp}.jpg`, and set as `avatar_url` directly
  (service role: no moderation round).
- Handle check: the availability check and the final write go through the Worker; a race on the
  unique constraint answers "taken" on save.
- Edit applies the same fields. Turning Admin on for an account that already has a suffixed handle
  shows the handle field with its current value; the admin may change it.
- Name and bio use the same length limits as the app's profile editing.
- **Name and handle rules** (my call, 2026-11-11). The app refuses a name or handle containing the
  app name and the handles `admin`, `support`, `official`, `team`, `moderator`
  (`supabase/functions/_shared/names.ts`), and the nightly `daily-moderation` sweep blanks any
  unchecked username containing the app name. **Admin team accounts are exempt** (the brand
  account is "Unchaind" / `@unchaind`); **non-admin team accounts follow the app's rules**, since
  they look like members. Either way, a name written by the dashboard counts as already checked:
  it must not be reset to unchecked and blanked overnight (today a service-role write of
  `username` resets `username_checked_at` through the `profiles_names` trigger, core/009). The
  builder picks the mechanism (a second update setting `username_checked_at`, or an SDK change to
  the trigger) and covers it with a test.
- **Current state of Unchaind prod** (checked 2026-11-11): the 8 team accounts are all non-admin
  and there is no admin account yet. The "Unchaind" admin account is created from the dashboard,
  so no "make an existing member a team account" action is needed.
- Every create and edit is written to `moderation_actions` with the actor's email.

## Composer (floats over every screen)

### Opening it

- A **"New post"** button at the top of the sidebar, under the community switcher; keyboard `C`
  when no field has focus. It shows the number of drafts in this community.
- Its menu (mockup section 3) lists the drafts: account avatar, account · topic, first words, who
  edited it last and when; and "Blank post". Clicking a draft opens it.
- From a team account's panel: "Write a post as …".

### Docked windows (mockup v1 section 2, v2 section 3)

- A composer is a window docked bottom-right, like a mail draft in Gmail or Apple Mail. The page
  behind stays usable.
- Several can be open: one expanded, the others minimized to a strip (account · first words).
  **Clicking the strip expands it** (no chevron); its only button is ✕.
- Window header: account · topic, then – (minimize), ⤢ (expand), ✕ (close).
- **⤢** opens the same draft large and centred over the dimmed dashboard (mockup v2 section 2);
  ⤡ or Esc puts it back in the dock.
- **✕ closes the window; the draft stays** in the list. **"Discard draft"** inside the composer
  deletes it for everyone, after a confirmation.
- Open windows are per browser tab and per community; switching community closes them (drafts
  stay).

### Fields

- **Account**: a picker of team accounts (avatar, name, Admin tag).
- **Topic**: the app's topics (see "Topics" below). Admin-only topics are offered only when the
  account is an admin.
- **Text**: required to publish, 1–2000 characters (the `posts.content` check). A draft may be
  empty.
- **Image** (if the community has the images module): one image, re-encoded to JPEG ≤ 2 MB in the
  browser, EXIF stripped, width and height recorded.
- **Poll** (if polls): 2 to 4 options.
- **Verse** (if attachments with the `verse` type): a reference field; shows the canonical
  reference and "✓ found", or why it is not understood.
- **Notify everyone** and **Pin**: offered only when the account is an admin (same rule as the
  app). Unchaind's push copy and inbox handle the rest (`broadcast_requested`).
- Footer: save state ("Saved · edited by Marie 2 min ago"), **Publish**.

Which of image / poll / verse may combine in one post is decided by what the app supports; the
builder checks the app's composer and offers the same combinations.

### Saving and publishing

- A draft saves automatically (debounced) while typing; the footer shows the state.
- Two people on the same draft: last save wins. If the draft changed since this window loaded it,
  the composer says so ("Marie edited this draft 1 min ago — reload / keep mine") instead of
  overwriting silently. A version number on the draft row is enough.
- **Publish** creates the post visible at once (`status = 'visible'`, `moderated_at` set, so the
  AI batch skips it), with its poll options, attachment and image; sets `pinned_at` when Pin is on
  and `broadcast_requested` when Notify is on; deletes the draft; logs `publish_post` in
  `moderation_actions` (actor email, post id, author id). All of it in one transaction (see SDK
  change). The existing triggers then translate it, push it and add inbox rows as for an app post.
- After publishing: a toast with "Open in the queue/feed" is out of scope until brick 6; a plain
  "Published as Unchaind" toast is enough.

## Topics

The topic ids live in each app's code today (Unchaind: `COMMUNITY_TOPICS`, ids such as
`prayer-requests`, `testimonies`; an event topic has `from` / `until`; none is admin-only today).
Until brick 9 moves topics to the database, the dashboard's community registry (`COMMUNITIES`)
gets a `topics` list per community: id, label (English), `adminOnly`, `from`, `until`. Event
topics outside their window are hidden from the picker. Keeping it in sync with the app is manual
until brick 9; the roadmap notes it.

## Verse references

The verse parser is Unchaind-specific: the dashboard gets a small per-app "attachment types"
extension, and for Unchaind a `verse` type that reuses the book-name list and reference parser of
the Unchaind repo (`lib/bookNames.ts`, `lib/bibleRefParser.ts`, `lib/community/verseAttachment.ts`)
copied into the dashboard, with their tests. It accepts the app's languages, abbreviations, and a
verse range in one chapter. The registry says which attachment types a community has.

"✓" means the reference was understood (book known, chapter and verse ≥ 1), not that the verse
exists: the dashboard has no verse counts, and versions number some verses differently. Showing
the canonical reference ("Philippians 4:6-7") lets the admin catch a typo. A straight port, no
new data (my call).

## SDK change: shared drafts (core)

A new core migration (next number in `core/`), released in an SDK minor version, applied to
Unchaind sandbox then prod (prod only with the usual approval).

- **`post_drafts`** table: id, `author_id` (profiles), the post fields (topic, content, image path
  and size, poll options, attachment), `notify`, `pin`, **`publish_at` (null; used by brick 7)**,
  `version`, `created_by` / `updated_by` (emails), timestamps. RLS on with no policy and no grant
  to `anon` / `authenticated`: only the service role reads or writes it. How the module-specific
  fields are stored (columns or one jsonb, given images / polls / attachments are optional
  modules) is the builder's call; the publish function must validate them as the app's own
  insert paths do.
- **`publish_post_draft(draft_id, actor_email)`**, service role only: the one transaction
  described under "Saving and publishing". Brick 7's cron will call the same function.
- **Images sweep**: `post_images_unreferenced()` must also treat a path referenced by a draft as
  referenced, or draft images get deleted overnight. A draft image is uploaded under the draft
  author's folder; if the author changes before publishing, the image is moved (or re-uploaded)
  to the new author's folder so the `{uid}/…` path rule holds.
- **`moderation_actions.action`** check gains `publish_post`, `create_team_account`,
  `update_team_account`.
- The roadmap's brick 4 "SDK change" column becomes "yes".

### Release order and communities without the migration (my call)

The dashboard deploys to production on every merge, and serves every community in the registry.
So it **probes each community** (does `post_drafts` exist?) and, where the migration is missing,
shows the composer and "+ New team account" disabled with "Needs community SDK x.y". Nothing
writes to a community before its migration. Order: SDK release → Unchaind sandbox migrated →
dashboard PR (tested on the preview, sandbox) → merge → Unchaind prod migrated when Guillaume
approves, which turns the features on there.

## API sketch (Worker)

All under the existing `/api/c/:app/:env/…` scope, Access-checked, CSRF-guarded, as in V1.

- `GET team-accounts` (or reuse the members list with the team filter) — what the account picker
  needs.
- `POST team-accounts`, `PATCH team-accounts/:id` — create / edit (multipart or a separate avatar
  upload step, builder's choice).
- `GET handles/:handle/available`.
- `GET drafts`, `POST drafts`, `PUT drafts/:id` (with `version`), `DELETE drafts/:id`.
- `POST drafts/:id/image` — upload; `POST drafts/:id/publish`.
- Topics and attachment types come with the community in the existing registry endpoint.

## Testing and verification

- Unit tests: verse parser (ported tests plus the dashboard's own), handle pre-fill
  (`Pastor James` → `pastorjames`, accents, emoji-only names), draft conflict detection,
  admin-only gating of topics / notify / pin.
- Worker tests as in V1 (mocked Supabase): create account, edit, publish, version conflict.
- SDK: migration test that `publish_post_draft` inserts a visible post with options / image /
  attachment, pins, requests the broadcast, deletes the draft, logs; that the images sweep keeps
  draft images; that `authenticated` cannot read `post_drafts`.
- End to end on the Unchaind **sandbox** (dashboard preview, then local): create an admin account
  with a custom handle and a non-admin one; edit one of the existing team accounts; two drafts at
  once, minimized and expanded; reopen a draft from another browser; publish a post with image,
  poll and verse, with Notify and Pin; check it in the app on the simulator (visible, translated,
  pinned, push and inbox row received, verse card opens the reader). Production stays read-only
  until Guillaume approves.

## What needs the team (outside code)

- Approve and release the SDK version with the drafts migration; apply it to Unchaind sandbox,
  then prod.
- Fill the topic list in `COMMUNITIES` for Unchaind (labels in English).

## Roadmap updates in the same PR (CLAUDE.md rule)

- Decided: replace "Managed accounts, three kinds" by "Team accounts are all equal (`is_house`),
  Admin switch only; admin accounts choose their handle" (2026-11-11); add "Drafts are shared, in
  the community database".
- Brick 4 row: new wording (team accounts, composer, shared drafts; comments and replies moved to
  brick 6), SDK change "yes". Brick 6 row: add "comment and reply as a team account". Brick 7 row:
  builds on the drafts table (`publish_at`, `publish_post_draft`).
- SDK coverage table: `post_drafts`, `publish_post_draft`.

## Left to the builder

- How the login-less auth user is created.
- Draft field storage (columns vs jsonb) and the exact autosave debounce.
- The verse parser port and how per-app attachment types are wired in the dashboard.
- Keyboard shortcuts beyond `C` and Esc.
- Which post combinations (image + poll + verse) to allow, matching the app.
