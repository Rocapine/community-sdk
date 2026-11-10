# Community dashboard — roadmap

The back office for the apps that embed the Community SDK: moderate, publish, measure and,
later, configure each app's community, in production and in sandbox. It replaces Rocactopus
(the Next.js dashboard of Eve's Rhythm and Nightward) and the Octopus dashboard, and is
built from scratch, one brick at a time: the smallest useful version first, then one brick per
iteration.

**This file is the single source of truth for what comes next.** Keep it current:

- **Working on the dashboard:** move the brick you start to _in progress_, and to _done_ (with the
  PR) when it ships. Add the bricks you discover; re-rank when priorities change.
- **Adding a feature to the SDK:** update the [SDK coverage](#sdk-coverage) table, and add or
  amend the dashboard brick that would manage it (often a one-line "Later" entry is enough).
- Record decisions in [Decided](#decided) with the date; questions go to [Open questions](#open-questions).

Status: `todo` · `in progress` · `done` · `dropped`. Size: **S** one session · **M** a few
sessions · **L** a project with its own design doc, usually with an SDK release.

Last reviewed: 2026-11-10, SDK 0.15.0. V1 (bricks 1–3) live at https://community.rocapi.ne.

## Needs it serves

From the team (2026-11-04):

1. **Moderate** — see what members reported and what the AI hid, and act on it. Today reports
   only reach Slack.
2. **Publish** — post as an admin account, or as profiles the team manages to seed the
   community, now or scheduled.
3. **Measure** — how much the community is used.
4. **Configure** — topics, community rules, moderation rules… Wanted, but not first: most of
   this config lives in each app's code or in Supabase secrets today, so it needs SDK work.

## Decided

- **2026-11-10 — Agile:** ship the smallest useful dashboard, then add bricks one by one, in the
  order below. Settings come late.
- **2026-11-10 — V1 scope:** Unchaind only, sandbox and production. Eve's Rhythm and Nightward
  wait for brick 19.
- **2026-11-10 — Where:** the Rocapine Cloudflare account (where `unchaind-dashboard` runs too),
  at `community.rocapi.ne`, in the repo [`Rocapine/community-dashboard`](https://github.com/Rocapine/community-dashboard).
- **2026-11-10 — Managed accounts, three kinds:** _brand_ (e.g. "Unchaind" with the app icon,
  for app news), _persona_ (a real first name and photo, a person posting for the app) and
  _seed_ (looks like any member, to liven up the community). Brand and persona carry the admin
  seal (`is_admin`); seed does not. All three are house accounts (`is_house`), kept out of the
  stats; the app cannot read `is_house`, so members never see it.
- **2026-11-10 — Octopus:** only users on old app versions are still there, and Octopus moderates
  its own community. The dashboard ignores it.
- **2026-11-10 — Shell (brick 1):** an app and sandbox/production switcher kept in the URL;
  production in a color that cannot be missed; the dashboard opens on the last community used;
  the home shows open reports and AI-hidden content to review, each linking to the review queue.
- **2026-11-10 — Theme:** a light/dark toggle from brick 1, the same two-state logic as
  `unchaind-dashboard` and `onboarding-studio` (follow the system by default; the toggle flips
  the theme and forgets the override when it matches the system again; see
  [Lea Verou](https://lea.verou.me/blog/2026/dark-mode-toggles/)). Copy `src/app/theme.ts` and the
  inline script of `index.html` from `unchaind-dashboard`.
- **2026-11-10 — Review queue (brick 2):** list + detail side by side. The queue on the left
  (All / Reported / AI-hidden); the selected item on the right with its context, every report,
  the author at a glance and the actions; keyboard J/K, H, R, B; each action moves on and offers
  Undo. "Open member" slides the member panel over the right side, without leaving the queue.
- **2026-11-10 — Members (brick 3):** one member panel, opened from the Members list (list +
  panel side by side; search on name, handle, user id, Amplitude or RevenueCat id; filters
  Admins, Reported, Banned, Team accounts) and slid over the review queue by "Open member". The
  panel: bio, counts, user id, links to Amplitude and RevenueCat, blocked-by count, badges, tabs
  Reports / Posts / Comments / Moderation, the Admin switch and Ban.
- **2026-11-10 — Bans:** a ban covers one profile, since each app links its users to
  community profiles its own way. The dashboard only flags when another profile with the same
  RevenueCat or Amplitude id is banned.
- **2026-11-10 — V1 design:** [2026-11-10-community-dashboard-v1-design.md](superpowers/specs/2026-11-10-community-dashboard-v1-design.md).
- **2026-11-10 — PR previews:** every pull request gets a Workers Builds preview on
  `*.workers.dev`, behind the same Access policy. Previews run unmerged code with the production
  code, so a preview gets its own config (`previews` block): the sandbox community and its key
  only; the production key never reaches a preview.
- **2026-11-10 — Independent project:** the dashboard is the team's own project, meant to
  replace Rocactopus; it does not follow Rocactopus's choices.
- **2026-11-04 — Hosting:** a Cloudflare Worker, deployed automatically on merge to `main`
  (Workers Builds), behind Cloudflare Access with the rule "emails ending in `@rocapine.com`",
  like `unchaind-dashboard`.
- **2026-11-04 — UI:** simple and modern, `shadcn/ui` wherever it has the component.
- **2026-11-04 — Switching:** one dashboard for every app, with a switcher between apps and
  between each app's production and sandbox communities. Unchaind (fully on the SDK) is the
  first app and the test bed.
- **Claude's call — stack:** copy `unchaind-dashboard`: Vite + React + Tailwind + shadcn/ui as
  static assets, plus a hand-written Worker for `/api/*`. No Next.js.
- **Claude's call — data access:** each community (app × environment) is one Supabase project.
  The Worker reaches it with that project's service-role (or `sb_secret_`) key, stored as a
  Worker secret; the browser never sees a key. The SDK has no admin role in RLS, so this is the
  only path, and the one Rocactopus uses.
- **Claude's call — identity:** Access decides who gets in. The Worker also verifies the Access
  JWT (`Cf-Access-Jwt-Assertion`) to know the email, which goes into `moderation_actions.actor_email`.
  The SDK's `admin_users` table stays unused.
- **Claude's call — roadmap location:** the dashboard has its own repo; this roadmap stays here,
  next to the SDK features it tracks.

## UI principles

Set by the team on 2026-11-10; every brick follows them.

- **Modern, not showy.** A tool used every day, not a landing page: intuitive and pleasant, no
  "wow" effects. Use the design skills available (frontend-design, shadcn, interface polish) where
  they help.
- **Fit each brick into what exists.** A new feature is not a new page by default. Before
  building a brick, work out where it belongs among the existing screens and in the user's flow,
  and change those screens if needed.
- **Fewer clicks, scrolls and page changes.** Use the whole screen, its width first: side panels,
  sheets, off-canvas drawers, dialogs, list + detail side by side.

### V1 — first useful version

| #   | Brick                                                                                                                                                                                                                                                                                                                                                                             | Size | SDK change | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- | ------ |
| 1   | **Shell.** Repo, Worker + SPA, shadcn, Access + JWT check, auto deploy, the community registry (Worker secrets), the app/environment switcher, an empty home. Starts with Unchaind sandbox and production.                                                                                                                                                                        | M    | no         | done   |
| 2   | **Review queue.** One list of what needs a human: open reports (grouped per post or comment, most reported first) and AI-hidden content not yet reviewed. Actions: hide, restore, keep hidden, reject the report, ban the author. Every action written to `moderation_actions` with the actor's email. Undo on the last action.                                                   | M    | no         | done   |
| 3   | **Members.** Find a member by name, handle or id; member card (posts, comments, reports received, hidden count, ban state, Amplitude and RevenueCat ids); ban / unban; **make admin / remove admin** (`is_admin`). Since SDK 0.15, an admin posts in admin-only topics, pins and notifies everyone from the app itself, so this alone covers "publish as an admin" until brick 4. | S    | no         | done   |

### Next

| #   | Brick                                                                                                                                                                                                                                                                                                   | Size | SDK change | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- | ------ |
| 4   | **Managed profiles and composer.** Create and list the team's profiles, of the three kinds in [Decided](#decided): brand, persona, seed (name, handle, avatar). Write a post as one of them: topic, text, image, poll, attachment; publish now; notify everyone; pin. Comment and reply as one of them. | M    | no         | todo   |
| 5   | **Activity.** 7 / 30 / 90-day charts from `admin_daily_metrics`: posts, comments, new posters, reply rate within 24 h, posts per topic. House accounts excluded.                                                                                                                                        | S    | no         | todo   |
| 6   | **Feed explorer.** Every post by topic and status, search on text and author, the thread with its comments, hide / pin from the list, "no answer yet" filter.                                                                                                                                           | M    | no         | todo   |
| 7   | **Scheduled posts.** Plan a post (brick 4's composer + a date) as a managed profile; list and calendar; edit or cancel before it goes out. The SDK publishes them (a `scheduled_posts` table and a cron in core).                                                                                       | M    | yes        | todo   |
| 8   | **Community info (read-only).** What each community runs: installed modules (probed from the schema), schema version, cron jobs and their last runs, Edge Functions, which secrets are set (names only, via the Management API). Catches a half-migrated sandbox.                                       | S    | no         | todo   |

### Later

| #   | Brick                                                                                                                                                                                                                                                    | Size   | SDK change | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------ |
| 9   | **Topics in the database.** The topic list (ids, labels per locale, `adminOnly`, event window `from` / `until`, order) read by the app from the database instead of its code, edited in the dashboard. First of the settings bricks; needs a design doc. | L      | yes        | todo   |
| 10  | **Community rules.** The rules text per locale, edited in the dashboard, read by the app.                                                                                                                                                                | M      | yes        | todo   |
| 11  | **Moderation rules.** Per category (harassment, sexual, self-harm…): hide, hide with human review, or let through; the score threshold. Today `CATEGORIES_TO_HIDE` is in code and the threshold is a secret.                                             | L      | yes        | todo   |
| 12  | **Other settings.** Translation locales, push copy, app name: today Supabase secrets, editable through the Management API without SDK change.                                                                                                            | M      | maybe      | todo   |
| 13  | **Dashboard roles.** Admin, community manager, moderator, read-only (Octopus has these). Only once more than the core team uses it.                                                                                                                      | M      | no         | todo   |
| 14  | **Insights.** A monthly AI summary: themes, sentiment, standout posts, top contributors, what to watch (Octopus "Insights").                                                                                                                             | L      | no         | todo   |
| 15  | **Community vs. app.** Retention and time in app of community members against the other users, from Amplitude (Octopus "Reports").                                                                                                                       | M      | no         | todo   |
| 16  | **Post series.** Plan several posts at once, e.g. a week of daily prompts (Octopus "Plan a series"). Builds on 7.                                                                                                                                        | M      | no         | todo   |
| 17  | **Support handoff.** Send a post to Roca Support, ready-made replies for moderators.                                                                                                                                                                     | M      | maybe      | todo   |
| 18  | **Member badges view.** See and reset a member's badges.                                                                                                                                                                                                 | S      | no         | todo   |
| 19  | **Other apps.** Eve's Rhythm and Nightward once their backends run the SDK schema; their Rocactopus extras (articles, stories, callouts) stay out of this dashboard.                                                                                     | S each | no         | todo   |

## SDK improvements for the dashboard

Proposed while building the dashboard; each is an SDK change for the SDK owner to accept or not.

| Proposal                                                                                                | Why it helps the dashboard                                                                     | Size | Status   |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---- | -------- |
| Indexes on `posts(author_id)`, `comments(author_id)`, `reports(reported_user_id)`, `blocks(blocked_id)` | `admin_user_stats` counts become index lookups, so the member list can filter and sort on them | S    | proposed |
| Allow `make_admin` / `remove_admin` in `moderation_actions.action`                                      | Admin changes appear in the audit log                                                          | S    | proposed |
| One RPC per moderation action (status + reports + log in one transaction)                               | No half-applied action if a call fails midway                                                  | M    | proposed |
| Restoring hidden content runs the publish side effects (inbox, push to the post author, translation)    | A restored comment reaches its post author like a normal one                                   | M    | proposed |

## SDK coverage

What each SDK feature gives the dashboard to manage. Update a row when the SDK changes.

| SDK feature (module)                                                   | Since             | What the dashboard can do with it                      | Brick   |
| ---------------------------------------------------------------------- | ----------------- | ------------------------------------------------------ | ------- |
| Posts, comments, replies, likes (core)                                 | 0.1, replies 0.13 | Read, hide, restore, pin                               | 2, 6    |
| AI moderation before publish (core)                                    | 0.1               | Review AI-hidden content                               | 2       |
| Reports and blocks (core)                                              | 0.1               | Review queue                                           | 2       |
| Bans (core)                                                            | 0.1               | Ban / unban                                            | 2, 3    |
| Moderation audit log, `admin_user_stats`, `admin_daily_metrics` (core) | 0.1               | Audit, member card, activity                           | 2, 3, 5 |
| Default names, editable name and handle (core)                         | 0.12              | Member search and card                                 | 3       |
| Admin accounts, admin-only topics (core)                               | 0.15              | Make admin; post as admin                              | 3, 4    |
| Pin posts (core)                                                       | 0.15              | Pin / unpin                                            | 4, 6    |
| Notify everyone (core + push)                                          | 0.15              | Notify on a dashboard post                             | 4       |
| Event topics `from` / `until` (app config)                             | 0.15              | Edit once topics move to the database                  | 9       |
| Push notifications (push)                                              | 0.1               | Copy in secrets                                        | 12      |
| Polls (polls)                                                          | 0.1               | Polls in the composer                                  | 4       |
| Private reaction, e.g. prayer (reaction)                               | 0.1               | Counts on posts                                        | 6       |
| Notification inbox (inbox)                                             | 0.1               | Admin posts appear once pushed                         | 4       |
| Translation (translation)                                              | 0.3               | Show the original and translations; locales in secrets | 6, 12   |
| Images (images)                                                        | 0.11              | Images in the composer and the review queue            | 2, 4    |
| Attachments (attachments)                                              | 0.15              | Attach app content in the composer                     | 4       |
| Member badges (badges; replaces streaks)                               | 0.15              | Badges on the member card                              | 3, 18   |

## Open questions

None right now.
