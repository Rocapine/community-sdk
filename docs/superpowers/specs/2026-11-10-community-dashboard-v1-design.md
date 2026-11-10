# Community dashboard V1 — design

Date: 2026-11-10. Status: draft for approval. Roadmap: [docs/dashboard-roadmap.md](../../dashboard-roadmap.md)
(bricks 1–3). Mockups: `.superpowers/brainstorm/15422-1794330611/content/` (`review-queue.html`,
option A; `members.html`).

## Why

Apps that embed the Community SDK have no back office. Today, member reports only reach Slack,
AI-hidden content is never reviewed by a human, and making someone an admin means editing the
database by hand. The team wants its own dashboard, independent from Rocactopus and meant to
replace it, built brick by brick from the smallest useful version.

V1 is that smallest version: **moderate** (review queue) and **manage members** (search, ban,
make admin). Making a team account an admin is enough to publish as an admin from the app itself
(SDK 0.15), so publishing needs no dashboard screen yet.

## Goals

- One dashboard for the Unchaind community, sandbox and production, switchable in one click.
- Review in one place everything that needs a human: open reports and AI-hidden content, with
  every action logged with who did it.
- Find any member, see their record, ban or unban them, make them admin or not.
- A layout that later bricks extend instead of piling pages on (see UI principles below).

## Non-goals (V1)

- Other apps (Eve's Rhythm, Nightward): later, brick 19.
- Composer, managed profiles, scheduling, stats, feed explorer, settings: later bricks.
- Octopus: users left on old app versions are moderated by Octopus itself.
- Roles inside the dashboard: everyone allowed in can do everything.
- Any change to the SDK. V1 uses the schema of SDK 0.15 as it is.

## Anti-goals

- A page per feature, navigation-heavy UI, a showy landing-page look.
- A Supabase key reaching the browser.
- Acting on production while believing it is sandbox.

## Constraints

- **Hosting:** a Cloudflare Worker on the **Rocapine** account, at `community.rocapine.com`,
  deployed by Workers Builds on every merge to `main`. Repo `Rocapine/community-dashboard`
  (local: `~/Developer/community-dashboard`).
- **Access:** Cloudflare Access (team `rocapine.cloudflareaccess.com`) with the rule "emails
  ending in `@rocapine.com`", like `unchaind-dashboard`. No login of our own.
- **Stack** (copy `~/Developer/unchaind-dashboard`): Vite + React 19 + Tailwind v4 + shadcn/ui
  served as static assets from `dist/`; a hand-written Worker for `/api/*`
  (`assets.run_worker_first: ["/api/*"]`, SPA fallback). No Next.js.
- **Data:** each community (app × environment) is its own Supabase project. The SDK has no admin
  role in RLS, so the Worker uses each project's secret key (`sb_secret_…`, or the legacy
  service-role key), stored as a Worker secret.
- **Copy and code language:** English (like the SDK). _Claude's call._

## UI principles (set by the team)

- Modern, calm, pleasant to use every day; no "wow" effects.
- A new feature is not a new page by default: find where it fits among existing screens.
- Fewer clicks, scrolls and page changes: use the screen's width (list + detail, side panels,
  sheets, dialogs).

Visual direction, _Claude's call_, from the mockups: Hanken Grotesk; neutrals tinted slightly
warm; one blue accent; red for destructive actions; shadcn components restyled through its CSS
variables, not rewritten. Before the UI work, write a `.impeccable.md` in the new repo with this
design context (audience: the Rocapine team; jobs: moderate, manage members, later publish and
measure; tone: calm, precise, not showy).

## Brick 1 — Shell

### Layout

A left sidebar, always visible:

- **Community switcher** at the top: app (Unchaind) and environment (Sandbox / Production). The
  selected community is in the URL (`/unchaind/prod/queue`, `/unchaind/sandbox/members/<id>`),
  so a link can be shared. The dashboard opens on the last community used (localStorage),
  production otherwise.
- **Production is unmistakable:** an orange line across the top of the window and an orange
  "Production" mark in the switcher. Sandbox has neither.
- **Navigation:** Home, Review queue (with the count of items to review), Members.
- **Footer:** "Signed in with Cloudflare Access" and the theme toggle.

**Home:** two counts, open reports and AI-hidden content not yet reviewed, each linking to the
review queue with the matching filter. Nothing else in V1.

### Theme

Light and dark from the start, the two-state toggle of `unchaind-dashboard` and
`onboarding-studio` (see [Lea Verou](https://lea.verou.me/blog/2026/dark-mode-toggles/)):
follow the system until the user flips it; flipping back to the system's theme forgets the
override. Copy `src/app/theme.ts` and the inline script in `index.html` from
`unchaind-dashboard`, and its `.dark` class approach in `index.css`.

### Community registry

A list of communities in `wrangler.jsonc` `vars` (no secrets in it), for example:

```jsonc
"COMMUNITIES": [
  { "app": "unchaind", "env": "prod", "name": "Unchaind",
    "supabaseUrl": "https://doiafuhoourjtqsmzook.supabase.co",
    "keySecret": "SUPABASE_KEY_UNCHAIND_PROD",
    "amplitudeUserUrl": "…{id}…", "revenuecatCustomerUrl": "…{id}…" },
  { "app": "unchaind", "env": "sandbox", "name": "Unchaind",
    "supabaseUrl": "https://vjcdpodsrpemanfvrshh.supabase.co",
    "keySecret": "SUPABASE_KEY_UNCHAIND_SANDBOX", "…": "…" }
]
```

Adding a community later = one entry + one secret. `GET /api/communities` returns the list
without secret names. The Amplitude and RevenueCat URL templates are filled by the builder from
the Unchaind Amplitude project and RevenueCat project; a missing template hides the link.

### Identity

Access decides who gets in. The Worker also verifies the `Cf-Access-Jwt-Assertion` JWT
(signature against the team's certs, audience = the Access application's AUD, expiry) on every
`/api/*` request and reads the email from it; it answers 401 without a valid token. The email
goes into `moderation_actions.actor_email`, `reports.resolved_by`, and `reviewed_by` on posts and
comments. Local development (`wrangler dev`) has no Access: a `DEV_ACCESS_EMAIL` var, set only in
`.dev.vars`, replaces the check there. It must never be set in production.

Known gotcha from `unchaind-dashboard`: when the Access session expires, `/api/*` answers 200
with an HTML login page. The client treats any non-JSON answer as "session expired" and reloads
the page, which goes through Access again.

### Deploy

Workers Builds connected to `Rocapine/community-dashboard`, deploying `main`. Custom domain
`community.rocapine.com` (check that the `rocapine.com` zone is on the Rocapine account; if not,
stop and ask). An Access application on that hostname with the `@rocapine.com` rule.

The "Rocapine" Cloudflare account is the one `unchaind-dashboard` runs on: the account
formerly named "Sammy", renamed "Rocapine" (account id `cd3f38fcaf8dca226a6c08ebc2616089`); its Access team is
`rocapine.cloudflareaccess.com`. The builder does the Cloudflare setup with wrangler and the
Cloudflare API when its credentials have the rights, and hands off to the team (with exact
steps) for anything it cannot do. The Access application's AUD goes into a Worker var for the
JWT check.

## Brick 2 — Review queue

### What is in the queue

An **item** is a post or a comment. It is in the queue when either:

- it has at least one **open report** (`reports.status = 'open'`), whatever its status; or
- it was **hidden by the AI and not yet reviewed**: `status = 'hidden'`,
  `moderation_reason is not null`, `reviewed_at is null`.

Deleted items (by their author) leave the queue: their open reports are shown as resolved by
nothing and ignored. _Claude's call._

Filters: **All**, **Reported**, **AI-hidden**. Order: reported items by number of open reports,
then most recent report; AI-hidden items by date. In **All**, reported items come first.

### Layout (option A, validated)

- **Left:** the list. Each row: kind and topic, age, the text (two lines), a chip with the
  number of reports and the main reason, or "AI hid · <category>", and the current status.
- **Right:** the selected item in full.
  - Its context: for a comment, the parent post above it (and the comment it replies to, if
    any); images and attachments as the app shows them.
  - Every open report: reason, reporter, details, age.
  - The AI's reason when it hid the item (`moderation_reason`).
  - History: the `moderation_actions` on this item.
  - The author at a glance: name, handle, member since, banned or not, posts, comments, reports
    received, hidden count; **Open member** (see brick 3).
- **Action bar** at the bottom of the right panel.

### Actions

| Item state                     | Actions                                                   |
| ------------------------------ | --------------------------------------------------------- |
| Visible, reported              | **Hide** (H), **Reject reports** (R), **Ban author…** (B) |
| Hidden by the AI, not reviewed | **Keep hidden** (H), **Restore** (R), **Ban author…** (B) |
| Hidden, reported again         | **Keep hidden**, **Restore**, **Ban author…**             |

What each action writes (all through the Worker, actor = Access email, `now()`):

- **Hide:** item `status = 'hidden'`, `reviewed_at/by`; its open reports → `resolved`,
  `resolution = 'content_hidden'`, `resolved_at/by`; log `hide`.
- **Keep hidden:** item `reviewed_at/by`; open reports → resolved, `content_hidden`; log
  `confirm_hide`.
- **Restore:** item `status = 'visible'`, `reviewed_at/by`; open reports → resolved,
  `rejected`; log `restore`.
  - _Claude's call:_ a post with `broadcast_requested = true` and `broadcast_at is null` (an
    admin post that asked to notify everyone, then hidden by the AI) would push to every user
    the moment it turns visible (`push/005_broadcast_trigger.sql`). Restore on such a post opens
    a dialog with a **"Notify everyone now"** checkbox, unchecked by default; unchecked, the
    Worker sets `broadcast_requested = false` before setting `visible`.
  - _Claude's call:_ the SDK's push, inbox and translation triggers fire only on
    `pending → visible`. A restored item therefore notifies nobody, and is translated by the
    next daily sweep. Acceptable for V1.
- **Reject reports:** item `reviewed_at/by`; open reports → resolved, `rejected`; log
  `reject_report`.
- **Ban author…:** see brick 3; the item itself is also hidden (as **Hide**) and its reports
  resolve as `user_banned`.

Writes are several PostgREST calls, not one transaction (no SDK change in V1). Order them so
that a retry is harmless (each step is idempotent: set fields to the target values, resolve only
`open` reports), and show an error with Retry if one fails.

**Flow:** after an action, the next item is selected. Keyboard: J / K next and previous, H, R,
B as above, Esc closes a panel or dialog. A toast shows the action with **Undo** for 5 seconds.
_Claude's call:_ Undo works by delaying the write: the item leaves the list at once
(optimistic), the writes are sent when the 5 seconds end, on Undo nothing is sent. Pending writes
are flushed when the page is hidden or closed (`pagehide` + `fetch(..., { keepalive: true })`).

## Brick 3 — Members

One **member panel**, opened two ways:

1. **Members** in the sidebar: a list + panel side by side.
   - Search: name or handle (contains, case-insensitive), or an exact user id, Amplitude id or
     RevenueCat id.
   - Filters: All, Admins (`is_admin`), Reported (reports received > 0), Banned, Team accounts
     (`is_house`).
   - Columns: member (avatar, name, handle, Admin / Banned / Team tags), posts, comments,
     reports received, joined. Paginated (50 per page, "Load more"). Default order: newest.
   - _Claude's call:_ since SDK 0.12 every user gets a profile, even without posting. The
     default list shows **active** members (at least one post, comment or report received);
     a filter **Everyone** and the search cover all profiles. Build the list from `profiles`
     and the content tables, and read `admin_user_stats` only for the rows shown (its counts are
     per-row subqueries, too slow to filter or sort across every profile).
   - The selected member is in the URL.
2. **Open member** in the review queue: the same panel slides over the right side of the queue;
   "Back to the item" or Esc closes it. The queue keeps its selection.

**The panel:** avatar, name, handle, member since, bio; counts (posts, comments, reports
received, hidden); user id (copy button); links to the member in Amplitude and RevenueCat;
blocked by N members; badges (if the badges module is installed); tabs **Reports** (received,
open and resolved, with their resolution), **Posts**, **Comments** (with status, newest first,
paginated), **Moderation** (`moderation_actions` targeting the member or their content). Clicking a
post or comment there opens it in the review-queue detail view (same component), in the panel.

**Footer actions:**

- **Admin** switch: sets `profiles.is_admin`. Confirmation only when turning it on in
  production ("<name> will be able to post in admin-only topics, pin and notify everyone").
  Not written to `moderation_actions` (its `action` check does not allow it; adding it is an SDK
  change for later). _Claude's call._
- **Ban…**: a dialog with an optional note (stored in `moderation_actions.note`) and a checkbox
  **"Also hide their visible posts and comments"**, checked by default. _Claude's call:_ a ban
  only stops new posts in the SDK (RLS); what they already wrote stays visible unless hidden.
  Writes: `is_banned = true`; their open reports → resolved, `user_banned`; log `ban`; if
  checked, each visible post and comment → `hidden` with `reviewed_at/by` (one `hide` log entry
  per item is not needed: the `ban` entry notes how many were hidden).
- **Unban** (when banned): `is_banned = false`, log `unban`. Hidden content stays hidden.

**A ban covers one profile** (decided by the team): each app links its users to community
profiles in its own way (Unchaind: an anonymous session per device), so the dashboard does not
guess who is the same person. It only **informs**: when another profile with the same
`revenuecat_id` or the same `amplitude_id` is banned, the member panel and the author summary in
the review queue show "Another profile with the same RevenueCat (or Amplitude) id is banned",
linking to it. Nothing shows when the ids are empty or no linked profile is banned.

**Data:** `admin_user_stats` (counts, ban, house, ids) joined in the Worker with `profiles`
(handle, bio, avatar, `is_admin`). The view is service-role only, which is what the Worker uses.

## API sketch (Worker)

All under `/api/c/:app/:env/…`, JSON, Access JWT required.

- `GET communities`, `GET summary` (home counts)
- `GET queue?filter=&cursor=`, `GET items/:kind/:id` (detail with context, reports, history)
- `POST items/:kind/:id/actions` `{ action: hide | keep_hidden | restore | reject_reports }`
- `GET members?q=&filter=&cursor=`, `GET members/:id`, `GET members/:id/{reports,posts,comments,moderation}`
- `POST members/:id/admin` `{ value }`, `POST members/:id/ban` `{ note, hideContent }`,
  `POST members/:id/unban`

The builder may reshape these; what matters is that the browser never talks to Supabase.

## Testing and verification

- Unit tests (Vitest): the JWT check (valid, wrong audience, expired, missing), the theme's
  `nextThemeAction`, the queue membership rule, each action's writes (against a mocked
  PostgREST).
- End to end against **Unchaind sandbox** only: create reports and AI-hidden items there, run
  every action, check the rows and the log. Never test writes on production.
- Before saying a brick is done: deployed on `community.rocapine.com`, Access works from a
  `@rocapine.com` account and refuses another one.

## What needs the team (outside code)

- Create the GitHub repo `Rocapine/community-dashboard`.
- Create a secret key in each Unchaind Supabase project (sandbox and production) and set them as
  Worker secrets.
- Cloudflare: Workers Builds connection, custom domain, Access application.
- The Amplitude project and RevenueCat project of Unchaind, for the member links.

## Left to the builder

- Routing library, data fetching library (TanStack Query is a sensible default), Supabase
  client in the Worker (`@supabase/supabase-js` or plain `fetch` to PostgREST).
- Exact shadcn components and the token values, within the visual direction above.
- Pagination mechanics, loading and empty states, error copy.
- How the queue query is built (a few PostgREST queries merged in the Worker is fine at
  Unchaind's volume).

## After V1

Update the roadmap: bricks 1–3 _done_ with their PRs, decisions moved there. The new repo's
`CLAUDE.md` points to `community-sdk/docs/dashboard-roadmap.md` and its UI principles.
