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

Last reviewed: 2026-11-13, SDK 0.20.0. V1 (bricks 1–3) live at https://community.rocapi.ne.

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
- **2026-11-11 — Team accounts, all equal:** every account the team manages is a house account
  (`is_house`, kept out of the stats; the app cannot read it) and the only difference is the Admin
  switch (`is_admin`): the admin seal and the admin powers (admin-only topics, pin, notify
  everyone). An admin account chooses its handle; the 8 accounts made on phones at launch are team
  accounts like any other. This replaces the 2026-11-10 "three kinds" (brand, persona, seed).
- **2026-11-11 — Shared drafts:** drafts live in the community database (`post_drafts`, service
  role only), so the whole team sees them on any device. Publishing goes through
  `publish_post_draft`, which requires an admin author for pin and notify everyone. An image-only
  post may have empty text, as in the app; which topics are admin-only comes from the dashboard's
  topic config, not from the database. Design:
  [2026-11-11-community-dashboard-brick4-design.md](superpowers/specs/2026-11-11-community-dashboard-brick4-design.md).
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

| #   | Brick                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Size | SDK change | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---------- | ------ |
| 4   | **Team accounts and composer.** Create and edit the team's accounts (photo, name, bio, Admin switch; an admin account chooses its handle), in Members. A composer that floats over every screen: write a post as any team account (topic, text, image, poll, Bible verse), notify everyone, pin, publish now; several drafts kept, shared by the team. Shipped: [dashboard#3](https://github.com/Rocapine/community-dashboard/pull/3), [sdk#78](https://github.com/Rocapine/community-sdk/pull/78) (SDK 0.16).                                                                                                                                                                                                                                                           | M    | yes        | done   |
| 5   | **Activity.** A page of its own (7 / 30 / 90 days) and a four-card overview on Home: posts, comments, new posters, reply rate within 24 h, posts per topic; the SDK adds contributions with their breakdown (posts, comments, likes, poll votes, reactions), unanswered posts, contributors by number of posts and comments, new and active members, median first reply, an activity heatmap by day and hour, languages, moderation counts, returning contributors and the most engaged posts (`admin_daily_metrics` reworked, `admin_activity_breakdown` added, `created_at` indexes). House accounts excluded. Shipped: [dashboard#5](https://github.com/Rocapine/community-dashboard/pull/5), [sdk#91](https://github.com/Rocapine/community-sdk/pull/91) (SDK 0.20). | M    | yes        | done   |
| 6   | **Feed explorer.** Every post by topic and status, search on text and author, the thread with its comments, hide / pin from the list, "no answer yet" filter, comment and reply as a team account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | M    | no         | todo   |
| 7   | **Scheduled posts.** Plan a post (brick 4's composer + a date) as a team account; list and calendar; edit or cancel before it goes out. Builds on `post_drafts.publish_at` and `publish_post_draft` (brick 4); the SDK adds the cron in core. Shipped: [dashboard#4](https://github.com/Rocapine/community-dashboard/pull/4), [sdk#80](https://github.com/Rocapine/community-sdk/pull/80) (SDK 0.16).                                                                                                                                                                                                                                                                                                                                                                    | M    | yes        | done   |
| 8   | **Community info (read-only).** What each community runs: installed modules (probed from the schema), schema version, cron jobs and their last runs, Edge Functions, which secrets are set (names only, via the Management API). Catches a half-migrated sandbox.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | S    | no         | todo   |

### Later

| #   | Brick                                                                                                                                                                                                                                                                                                         | Size   | SDK change | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------ |
| 9   | **Topics in the database.** The topic list (ids, labels per locale, `adminOnly`, event window `from` / `until`, order) read by the app from the database instead of its code, edited in the dashboard. First of the settings bricks; needs a design doc.                                                      | L      | yes        | todo   |
| 10  | **Community rules.** The rules text per locale, edited in the dashboard, read by the app.                                                                                                                                                                                                                     | M      | yes        | todo   |
| 11  | **Moderation rules.** Per category (harassment, sexual, self-harm…): hide, hide with human review, or let through; the score threshold. Today `CATEGORIES_TO_HIDE` is in code and the threshold is a secret.                                                                                                  | L      | yes        | todo   |
| 12  | **Other settings.** Translation locales, push copy, app name: today Supabase secrets, editable through the Management API without SDK change; preferred publishing times per app (quick picks in the composer's Schedule panel); the online grace window (`presence_set_grace_minutes`, presence module).     | M      | maybe      | todo   |
| 13  | **Dashboard roles.** Admin, community manager, moderator, read-only (Octopus has these). Only once more than the core team uses it.                                                                                                                                                                           | M      | no         | todo   |
| 14  | **Insights.** A monthly AI summary: themes, sentiment, standout posts, top contributors, what to watch (Octopus "Insights").                                                                                                                                                                                  | L      | no         | todo   |
| 15  | **Community vs. app.** Retention and time in app of community members against the other users, from Amplitude (Octopus "Reports").                                                                                                                                                                            | M      | no         | todo   |
| 16  | **Post series.** Plan several posts at once, e.g. a week of daily prompts (Octopus "Plan a series"). Builds on 7.                                                                                                                                                                                             | M      | no         | todo   |
| 17  | **Support handoff.** Send a post to Roca Support, ready-made replies for moderators.                                                                                                                                                                                                                          | M      | maybe      | todo   |
| 18  | **Member badges view.** See and reset a member's badges.                                                                                                                                                                                                                                                      | S      | no         | todo   |
| 19  | **Other apps.** Eve's Rhythm and Nightward once their backends run the SDK schema; their Rocactopus extras (articles, stories, callouts) stay out of this dashboard.                                                                                                                                          | S each | no         | todo   |
| 20  | **Online now.** The current online count on the dashboard home, from the `presence` module.                                                                                                                                                                                                                   | S      | no         | todo   |
| 21  | **Release markers.** The app's store releases and OTA updates as markers on Activity's posts-and-comments chart. The community database knows nothing of releases: the Worker would read EAS (builds, updates), App Store Connect / Google Play or the Publishing Platform, with a key and a setting per app. | M      | no         | todo   |

## SDK improvements for the dashboard

Proposed while building the dashboard; each is an SDK change for the SDK owner to accept or not.

| Proposal                                                                                                                       | Why it helps the dashboard                                                                     | Size | Status   |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---- | -------- |
| Indexes on `posts(author_id)`, `comments(author_id)`, `reports(reported_user_id)` (`blocks(blocked_id)` shipped in core `016`) | `admin_user_stats` counts become index lookups, so the member list can filter and sort on them | S    | proposed |
| Allow `make_admin` / `remove_admin` in `moderation_actions.action`                                                             | Admin changes appear in the audit log                                                          | S    | proposed |
| One RPC per moderation action (status + reports + log in one transaction)                                                      | No half-applied action if a call fails midway                                                  | M    | proposed |
| Restoring hidden content runs the publish side effects (inbox, push to the post author, translation)                           | A restored comment reaches its post author like a normal one                                   | M    | proposed |

## SDK coverage

What each SDK feature gives the dashboard to manage. Update a row when the SDK changes.

| SDK feature (module)                                                   | Since             | What the dashboard can do with it                      | Brick   |
| ---------------------------------------------------------------------- | ----------------- | ------------------------------------------------------ | ------- |
| Posts, comments, replies, likes (core)                                 | 0.1, replies 0.13 | Read, hide, restore, pin                               | 2, 6    |
| AI moderation before publish (core)                                    | 0.1               | Review AI-hidden content                               | 2       |
| Reports and blocks (core); mutual blocks, unblock (core `016`)         | 0.1, mutual 0.17  | Review queue; blocked-by count on the member card      | 2, 3    |
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
| Post drafts, `publish_post_draft` (core `014_post_drafts`)             | 0.16              | Shared drafts; publish as a team account               | 4, 7    |
| Draft images (images `002_draft_images`)                               | 0.16              | Images in drafts, kept by the nightly sweep            | 4       |
| Scheduled posts (core `015`)                                           | 0.16              | Composer, Home                                         | 7       |
| Activity metrics and breakdown, `created_at` indexes (core `017`)      | 0.20              | Activity page and Home overview                        | 5       |
| Member badges (badges; replaces streaks)                               | 0.15              | Badges on the member card                              | 3, 18   |
| Online presence (presence)                                             | 0.18              | Online count on the home; grace window in settings     | 12, 20  |

## Open questions

None right now.
