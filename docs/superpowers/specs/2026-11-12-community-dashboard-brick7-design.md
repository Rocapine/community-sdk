# Community dashboard, brick 7: scheduled posts

Status: approved 2026-11-12 (Guillaume). Mockups: `.superpowers/brainstorm/53205-1794425101/content/brick7-scheduling.html`.

## Why

The team publishes as its team accounts to keep the community alive (seeding, daily verse, prayer
prompts, challenge announcements). Brick 4 lets them write and publish now. They also need to
prepare posts in advance and have them go out at the right hour, for example 8:00 for a morning
prayer, without being at a computer. The roadmap need is "Publish … now or scheduled".

Brick 7 follows brick 4 directly. SDK 0.16.0 ships both (decision 2026-11-12): nothing is
urgent, and one release means one Unchaind upgrade and one prod migration.

## Goals

- Schedule any draft from the composer for a date and time, as its team account. Everything a
  post can carry is allowed: text, image, poll, verse, Notify everyone, Pin.
- The post goes out on its own at that time, within a minute, through the same
  `publish_post_draft` as "Publish now": same checks, same translation, broadcast and log.
- See what is going out: a week calendar on Home, and the scheduled posts in the New post menu.
- Before it goes out: edit it (autosave as usual), change the time, unschedule it (back to a
  draft), publish it now, or discard it.
- A scheduled post that can't go out says so, with the reason, where the team looks (Home, the
  menu, the composer). It is never published wrong, and never lost.

## Non-goals

- Recurring posts ("every Monday"). Each post is scheduled once; Duplicate can come later.
- A month view, and drag-and-drop to move a post. The week view with ‹ › is the calendar.
- Slack or email alerts for a failure. The dashboard shows it; an alert can come with the
  roadmap's alerts work.
- Scheduling comments or replies (brick 6 territory).
- A default time zone per community. The zone is chosen per post, when scheduling.

## Anti-goals

- A post going out with content other than what the team last saw saved. The cron publishes the
  draft's current saved version, exactly what the composer shows as "Saved".
- A new page. Scheduling lives in the composer, the New post menu and Home (UI principles).
- Silent failure. A due post that fails stays visible as "didn't go out" until someone acts.

## Decisions (my calls unless noted)

### Composer (mockup 1, 2)

- The Publish button becomes a split button: **Publish** and **▾**. The arrow opens "Publish
  now" and "Schedule…". "Schedule…" opens a small popover with a date and a time (native
  `input type="date"` / `type="time"`, so no new date-picker dependency), and three quick picks:
  tomorrow 08:00, tomorrow 19:00, next Monday 08:00, read in the chosen zone. Then a **time zone**
  select (decided by Guillaume, 2026-11-12): the zone this browser used last, else the browser's
  own zone, comes first; then a few common ones (Europe/Paris, Europe/London, America/New_York,
  America/Chicago, America/Los_Angeles, America/Sao_Paulo, UTC); then every IANA zone
  (`Intl.supportedValuesOf("timeZone")`). Each option shows its current offset ("New York ·
  UTC−5"). When the chosen zone isn't the browser's, one line under the fields gives the time
  in the browser's zone ("14:00 your time"). No other hint text (decided by Guillaume: no
  "goes out within a minute" line). Then Cancel and Schedule.
- Schedule requires what Publish requires (account, topic, text or image, valid extras, Pin and
  Notify only for an admin account). The topic must also be offered on the scheduled date:
  `visibleTopics(topics, admin, <scheduled date>)` instead of today's date, so an event topic
  works for a date inside its window. The time must be at least 2 minutes ahead and at most
  1 year ahead.
- On Schedule: the draft is saved, the date set, the window closes, and a toast says
  "Scheduled for Thu 13 Nov, 08:00". Times are written in the post's own zone, with the zone
  added when it isn't the browser's ("Thu 13 Nov, 08:00 New York").
- A scheduled draft, reopened, shows a banner at the top: "🕗 Scheduled for Thu 13 Nov, 08:00 ·
  by marie", then **Change** (the same popover) and **Unschedule** (back to a plain draft). Its
  edits autosave as usual and keep the date. The split button reads **Publish now** ▾. The ▾
  menu offers "Change time" and "Unschedule".
- A post that didn't go out shows a red banner instead: "Didn't go out at Wed 08:00:
  <reason>". It offers **Schedule again** and **Publish now**. The reason uses the same messages
  as a failed Publish (`ERRORS` in ComposerWindow).
- The cron may publish a scheduled draft while a window has it open. The window then turns to
  the brick 4 "deleted" state. My call: its message says "Published at 08:00 as scheduled" when
  the draft had a date that is now past, and keeps "Published or discarded by someone else"
  otherwise.

### New post menu (mockup 4)

- The menu shows when there is a draft or a scheduled post. It has two sections: "Drafts · n"
  with "Blank post", and "Scheduled · m". The scheduled ones are sorted by date, failed ones
  first, each with its time ("today 19:00", "Thu 08:00") or "didn't go out" in red.
- The badge on New post counts drafts only (unscheduled). With no drafts and no scheduled posts,
  New post still opens a blank post in one click.

### Home (mockup 3)

- Below the two counts: **Scheduled · n**, a 7-day week (Monday to Sunday). ‹ › moves week by
  week, and a click on the title returns to this week. Each day lists its posts as small cards
  (time, account, first words, 📊/📖/🖼 when it has a poll, verse or image). A click opens the
  composer. The empty state is one line: "Nothing scheduled this week".
- Past days of the shown week also list the posts the team accounts actually published those
  days, muted ("published"), so the week reads as a plan. My call, cheap: posts by `is_house`
  authors in the week, from `posts`.
- Failed scheduled posts also show as one red line above the week, per post: "Didn't go out:
  "<first words>" (<when>) — <reason>", with Open.

### SDK (core, new migration `core/015_scheduled_posts.sql`, my call)

Brick 4's `014` is already applied on the Unchaind sandbox, so brick 7 adds a new file rather
than editing 014. Both ship in 0.16.0.

- `post_drafts` gains `scheduled_by text` (the email that set the date), `publish_tz text` (the
  IANA zone chosen, for display only; `publish_at` is the instant), `publish_error text`
  (the code of the last failure) and `failed_at timestamptz`, plus a partial index on
  `publish_at` where `publish_at is not null and publish_error is null`.
- **`schedule_post_draft(p_draft_id, p_version, p_publish_at, p_tz, p_actor)`**, service role only.
  With a time, it checks the draft as `publish_post_draft` would. The check code is shared by
  moving it into one function both call; the builder chooses how. It also checks the time is in
  the future, then sets `publish_at` and `scheduled_by` and clears the error. With null it
  unschedules. It bumps `version`, as every write to a draft does, and raises the same codes,
  plus `invalid_time`.
- **`publish_due_post_drafts()`**, run by pg_cron every minute (job `post-drafts-publish`,
  scheduled like the inbox purge jobs, idempotent). For each draft with `publish_at <= now()` and
  no error, taken in order with `for update skip locked`, it calls `publish_post_draft(id,
version, scheduled_by)` in its own sub-transaction. On error it records `publish_error` (the
  code) and `failed_at`, keeps `publish_at` and moves on. A failed draft is not retried until
  someone schedules it again. The log line is the usual `publish_post` with `actor_email =
scheduled_by`.
- **Late posts (decided by Guillaume, 2026-11-12):** a due draft more than **30 minutes** past
  its `publish_at` is not published. The cron may have stopped for a while: an outage, a paused
  or restored backend, or a migration that lands after the date. The cron records
  `publish_error = 'missed'` and `failed_at` instead, like any failure. The composer's message
  for it is "It was due more than 30 minutes ago, so it didn't go out". The team then chooses
  Schedule again or Publish now.
- `moderation_actions.action` gains `schedule_post`, logged by `schedule_post_draft` for both
  schedule and unschedule.
- Tests in `supabase-tests/post-drafts.sql` or a new `scheduled-posts.sql`:
  - scheduling: every refusal, a past time, unscheduling;
  - the cron function: it publishes a due draft, skips future ones, and records the failure of a
    bad one while still publishing the next one. A draft due more than 30 minutes ago gets
    `missed` and is not published; one due 29 minutes ago is published;
  - a second run publishes nothing twice.

### Dashboard

- Features: `probeFeatures` gains `scheduling` (`post_drafts.scheduled_by` exists). Without it,
  "Schedule…" is disabled with "Needs community SDK 0.16".
- `Draft` gains `publishAt`, `scheduledBy`, `publishError`, `failedAt`. New route `POST
drafts/:id/schedule {version, publishAt | null}` → `schedule_post_draft`. A 409 behaves as for
  a save (conflict banner).
- New route `GET week?from=YYYY-MM-DD` for Home. It returns the scheduled drafts with a
  `publish_at` in [from, from+7d), the failed ones, and the team accounts' published posts of
  those days (id, author, first words, created_at, extra kind). Or the builder folds this into
  the drafts list plus one posts query.
- Time: the composer turns the chosen date, time and zone into an instant and sends it as ISO
  (UTC), with the zone name. It is stored as `timestamptz` plus `publish_tz`. The banner and the
  menu show a post's time in its own zone. The Home week is laid out in the browser's zone,
  since a calendar has one time axis, and a card whose zone differs also shows its own time. The
  `schedule` route takes `{version, publishAt | null, timeZone}`, and the zone must be a valid
  IANA name (`Intl.DateTimeFormat` accepts it).

## Constraints

- Everything from brick 4's spec still holds: service-role-only drafts, JSON-only writes, the
  actor is the Access email, no hint text under fields, UI copy in English, calm UI.
- Production stays read-only for agents. Guillaume runs the prod migration.
- The cron runs only once the migration is on a backend (sandbox now, prod after the joint
  release).

## Release

- `.changeset/post-drafts.md` already asks for a minor bump. This brick adds its own changeset
  (minor), and both land in 0.16.0.
- The SDK PR carries the roadmap update: brick 4 done (dashboard#3, sdk#78), brick 7 in
  progress, then done at merge. It also updates the SDK coverage row (cron publishing).
- After the release, the Unchaind branch `chore/community-sdk-0.16` gets `upgrade` again, which
  adds `015`, then the npm bump, PR, sandbox `migration repair` or `db push`, and the prod push
  by Guillaume.

## Left to the builder

How the shared draft check is factored. Whether Home's week data is one route or two. Component
structure.

## Revisions 2026-11-12 (Guillaume)

- Transient database errors (serialization failure, deadlock, lock not available) are retried:
  the cron leaves the draft untouched and the next minute's run tries again. The 30-minute
  `missed` rule still bounds the retries. Every other error is recorded as before.
- Event topics can be scheduled ahead, before they open, within their dates. The UI restricts the
  dates to the topic's window and warns when a topic change puts the chosen time outside it.
- The window lives in the dashboard's config, so the dashboard writes `topic_from` and
  `topic_until` (dates, `until` exclusive) on the draft with the topic. `check_post_draft` raises
  `topic_closed` when the local publish date falls outside them, and `schedule_post_draft` checks
  the new time before writing it. The cron marks a due draft whose window closed `topic_closed`.
- Quick picks are removed. A later settings brick may offer preferred publishing times per app.
