# Community dashboard, brick 5: Activity

Date: 2026-11-12. Status: approved by Guillaume on 2026-11-13 (palette v3 pending his look). Roadmap:
[docs/dashboard-roadmap.md](../../dashboard-roadmap.md)

## Why

The team needs to know whether the community is alive and getting better: how much members
post and comment, whether newcomers start posting, and whether a post gets an answer. Today
nobody sees these numbers without a SQL query. The roadmap's need: "7 / 30 / 90-day charts
from `admin_daily_metrics`: posts, comments, new posters, reply rate within 24 h, posts per
topic. House accounts excluded."

`admin_daily_metrics` exists since SDK 0.1, but it doesn't give those numbers right (see "The
function today"). Guillaume decided (2026-11-12) to fix it in the SDK, which makes brick 5 an
SDK change.

## Goals

- On Home, a section **Activity** with a 7 / 30 / 90-day toggle. Each number is compared with
  the period just before it: "▲ 8 %", or in points for a rate.
- The roadmap's numbers: posts, comments, new posters, the reply rate within 24 h, posts per
  topic. Plus three that Guillaume picked from the Octopus dashboard's Reports and Insights
  pages (2026-11-12): **contributions** (posts, comments, likes, poll votes, reactions) with
  their breakdown, **unanswered posts**, and **members by number of contributions**.
- The team's own accounts (house accounts) are left out of every number.
- Days follow the browser's time zone, like the Scheduled week.
- Charts made with **Bklit UI** (decided by Guillaume), restyled through our CSS variables.
- A **chart palette** of 7 colours that the whole dashboard can reuse later.

## Non-goals

- Views, visits, sessions, time in the app and retention. The SDK doesn't track app opens or
  post views. Octopus shows these; for us they belong to brick 15 (Community vs. app, from
  Amplitude).
- Top posts, top contributors, topics on the rise, sentiment: brick 14 (Insights).
- A link from "unanswered posts" to the list of those posts: brick 6 (Feed explorer) has the
  "no answer yet" filter. The number comes first, the link with brick 6.
- Export (CSV, PDF), custom date ranges, platform split (iOS / Android).
- A new page. Activity lives on Home (UI principles).

## Anti-goals

- A wrong number shown as right. The old function counted the team's posts and self-replies
  (see below). A number the backend can't give is left out, never estimated.
- A colour pair that Guillaume, who is colour-blind, can't tell apart. Colour never carries
  meaning alone: every rise or drop also has ▲ / ▼ and a sign, and every series has a label.
- "Wow" charts. Calm, readable, the same visual weight as the rest of Home.

## The function today (core/004)

`admin_daily_metrics(from_date date, to_date date)` returns
`{daily: [{day, posts, comments, new_posters, hidden}], topics: [{topic, count}], reply_rate}`.

What's wrong with it for Activity:

1. **House accounts** are excluded only from `new_posters` and `reply_rate`. Posts, comments
   and topics count the team's posts.
2. **Reply rate:** a comment by the post's own author counts as a reply, and so do deleted
   comments. Posts younger than 24 h count as "not answered", so the rate drops at the end of
   every period. It is one number for the period, so there is no trend and the previous period
   can't be compared without a second call.
3. **New posters:** a member's first post counts even if it was deleted.
4. **Days are UTC** (`created_at::date`), not the team's time zone. Filtering on
   `created_at::date` can't use the `posts_feed_idx` / `comments_post_idx` indexes.
5. Nothing about likes, poll votes, reactions, unanswered posts or how many members take part.

## The SDK change: core/017_activity_metrics.sql

Number: core/016 is taken by mutual blocks ([sdk#82](https://github.com/Rocapine/community-sdk/pull/82),
open). This one is 017. If #82 doesn't merge first, renumber at merge time. Requires core/004.
Fully idempotent.

### Signature

```sql
drop function if exists public.admin_daily_metrics(date, date);
create or replace function public.admin_daily_metrics(from_date date, to_date date, tz text default 'UTC')
  returns jsonb language plpgsql stable ...
revoke execute on function public.admin_daily_metrics(date, date, text) from public, anon, authenticated;
```

The same name, as Guillaume asked ("fix the function"). The old two-argument signature is
dropped: keeping it next to a three-argument one with a default would make a two-argument call
ambiguous. A call with two arguments still works and means UTC, as before. `tz` must be a valid
IANA zone; anything else raises `invalid_time_zone`.

Days are `from_date` to `to_date` included, in `tz`. Filter rows on
`created_at >= (from_date::timestamp at time zone tz)` and
`created_at < ((to_date + 1)::timestamp at time zone tz)` so the indexes work, then bucket each
row by `(created_at at time zone tz)::date`.

`plpgsql` because poll votes and reactions live in optional modules (`polls`, `reaction`): their
counts run through `execute` only when `to_regclass('public.poll_votes')` /
`to_regclass('public.post_reactions')` is not null, so core installs without them. A missing
module gives `null` for that count, not 0: the dashboard hides the row.

### Definitions (decided by Guillaume, 2026-11-12)

- **Member:** a profile with `is_house = false`. Every count below is about members only.
- **Post / comment:** any status but `deleted`, so AI-hidden and pending items count. The
  content was written, which is what Activity measures.
- **New poster:** a member whose first post that isn't deleted falls in the period.
- **Replied within 24 h:** a member's post that got a comment not deleted, by anyone other than
  its author, within 24 h of the post. A comment by a team account counts: the team answering
  is the point. Only posts created at least 24 h before `now()` are in the rate, so the end of
  a period isn't pulled down.
- **Unanswered post:** a member's post created at least 24 h ago, in the period, with no comment
  (not deleted) by anyone other than its author, at any time.
- **Like:** a row in `likes` (posts) or `comment_likes`, made by a member, on content made by
  anyone. **Poll vote:** a row in `poll_votes` by a member. **Reaction:** a row in
  `post_reactions` by a member (the module's private secondary reaction, such as prayer).
- **Contribution:** a post, comment, like, poll vote or reaction by a member.
- **Contributor:** a member who wrote at least one post or comment in the period.
  **Reactor:** a member who only liked, voted or reacted.

### Result

The existing keys stay with the same names and the same shape, with the corrected meanings
above. New keys are added.

```jsonc
{
  "tz": "Europe/Paris",
  "daily": [
    {
      "day": "2026-11-03",
      "posts": 14,
      "comments": 46,
      "new_posters": 2,
      "hidden": 0, // existing
      "likes": 120,
      "poll_votes": 9,
      "reactions": 31, // null when the module is absent
      "replied_24h": 9,
      "reply_eligible": 12, // posts of that day
      "contributors": 41, // distinct that day: for the sparkline only, days don't add up to the period
    },
  ],
  "topics": [
    { "topic": "prayer", "count": 148 },
    { "topic": "(sans)", "count": 36 },
  ], // existing; members' posts only
  "reply_rate": 0.71, // existing: sum(replied_24h) / sum(reply_eligible), 0 when none are eligible
  "unanswered": 12,
  "contributors": 230,
  "reactors": 410,
  "contribution_buckets": { "1": 106, "2-3": 69, "4-7": 37, "8+": 18 }, // contributors by number of posts + comments
}
```

`hidden` keeps its old meaning: posts hidden by moderation that day.

### Tests

`supabase-tests/activity-metrics.sql`, in the pattern of `scheduled-posts.sql`: a `do` block
that inserts members, a house account, posts, comments, likes and (when present) poll votes and
reactions at chosen times, checks every key, then raises `ACTIVITY_METRICS_TESTS_PASSED` to roll
back. Cases: house accounts excluded everywhere; a self-reply doesn't count; a deleted comment
doesn't count; a team reply counts; a post under 24 h old is out of the rate and out of
"unanswered"; a deleted first post doesn't make a new poster; a row at 23:30 UTC falls on the
next day in Europe/Paris; an invalid zone raises; a two-argument call still works. Run against
the Unchaind sandbox only.

Copy the migration into `packages/cli/templates/migrations/core/` as the other migrations are.
It ships in the next SDK release, through the repo's usual release PR (like #81). Guillaume
applies it to production; I apply it to the sandbox only.

## The dashboard change

### Worker

- `GET /api/c/:app/:env/activity?days=7|30|90&tz=<IANA>`. `days` outside 7 / 30 / 90 → 400;
  `tz` goes through `safeZone`. The period ends **yesterday** in `tz`: only complete days, so a
  morning's partial day doesn't look like a drop, and the comparison is fair. The previous
  period is the `days` days before it. The two RPC calls run in parallel. The response is
  `{from, to, previous: {from, to}, current: Metrics, before: Metrics}`, mapped to camelCase in
  `src/shared/types.ts`.
- Feature probe: `activity` in `probeFeatures`. It calls `admin_daily_metrics` with
  `tz: 'Invalid/Zone'`, so the new function raises `invalid_time_zone` before it reads a row:
  that error means true. PostgREST's "function not found" (`PGRST202`) means the old function,
  so false. Any other error throws, like the other probes. (My call: the probe stays cheap
  although it runs on every features call.)
- No refactor of `communities.ts`, `access.ts` or the registry.

### Home

Order on Home: the two counts (what needs a look now), the Scheduled week, then **Activity**,
full width. Activity is read after the work is done.

When the probe is off, the section shows its title and one muted line: "Activity needs the latest
community SDK." Nothing else. No version number: which release carries core/017 depends on
when #82 ships (my call).

Layout (mockup shown in chat on 2026-11-12, with illustrative numbers):

1. **Header:** "Activity", then on the right the toggle 7 d · 30 d · 90 d (shadcn `Tabs` or a
   segmented control already in the codebase, default 30 d, remembered in `localStorage` per
   browser), and the dates in muted text ("13 Oct – 11 Nov, vs the 30 days before").
2. **Four stat cards** (Bklit `stat-card` block with a sparkline): Contributions, Contributors,
   New posters, Replied within 24 h. Each shows the period's value, the change against the
   previous period (▲ / ▼ + sign + % or "pts" for the rate, `--chart-positive` /
   `--chart-negative`), and a sparkline of the daily values. Under the reply rate, in muted
   text, "12 unanswered", with no comparison: older posts have had more time to get an
   answer, so comparing would always make the current period look worse (my call). The
   Contributors sparkline uses the per-day distinct count, while its value is the period's
   distinct count.
3. **Posts and comments per day:** Bklit area chart, two series (slot 1 posts, slot 2
   comments), weekends shaded, crosshair tooltip with both values and the day. Daily points at
   7, 30 and 90 days.
4. Below, two panels side by side, stacked on narrow screens:
   - **Contributions:** a small table, one row per kind (Posts, Comments, Likes, Poll votes,
     Reactions; a row whose module is missing is hidden): total, per day, a sparkline, the
     change. Posts and comments are counted here too, so the total adds up.
   - **Posts per topic:** Bklit horizontal bar chart, sorted, one colour (slot 1), value labels
     at the end of each bar, "(sans)" shown as "No topic" in grey. Topic labels come from the
     community's topic config (`topicLabel`), as elsewhere.
5. **Contributors by contributions:** one segmented bar for 1, 2–3, 4–7 and 8+ posts and
   comments, with a legend that gives each share. The buckets are ordered, so they use one hue
   in four steps of the blue ramp, not four colours. A single line with no axis.

States follow `ScheduledWeek`: a `Skeleton` while loading, a `role="alert"` box with Retry on
error (a server error is shown, not retried), and "No activity in this period" when every number
is 0. Switching the period keeps the previous data on screen until the new data arrives
(`placeholderData`). Queries are keyed by community, period and zone, `staleTime` 5 minutes.

### Bklit UI

`components.json` gets `"registries": {"@bklit": "https://bklit.com/r/{name}.json"}`. The
components are added with `npx shadcn add @bklit/<name>` and copied into the repo as source:
area chart, bar chart, sparkline, the stat card block, and what they pull in (chart context,
tooltip, grid, axes, weekends). New dependencies come with them: `d3-shape`, `d3-scale`,
`d3-array`, `motion`, `@number-flow/react`. Report the bundle size before and after in the PR.
Components are restyled through variables, not rewritten. Edit a copied file only where our
tokens can't reach.

### Chart palette

Seven tokens in `src/app/index.css`, light and dark, in oklch like the rest. Built from our blue
(`--primary`), orange (`--prod`) and red (`--destructive`). Every pair, not only neighbours, is
checked under protanopia and deuteranopia, and spread mainly by lightness. Version 3. Guillaume
(colour-blind) found amber too close to orange and violet too close to blue in version 1 (all-pairs
ΔE 1.2 and 1.5), then dark orange still too close to bronze in version 2 (8.4).

| Token              | Hue    | Light                | Dark                 |
| ------------------ | ------ | -------------------- | -------------------- |
| `--chart-1`        | blue   | `50% 0.13 265`       | `64% 0.12 265`       |
| `--chart-2`        | orange | `70% 0.16 55`        | `72% 0.15 55`        |
| `--chart-3`        | teal   | `64% 0.12 195`       | `76% 0.10 195`       |
| `--chart-4`        | bronze | `52% 0.12 85`        | `52% 0.12 85`        |
| `--chart-5`        | plum   | `46% 0.12 350`       | `58% 0.12 350`       |
| `--chart-positive` | green  | `58% 0.14 150`       | `70% 0.14 150`       |
| `--chart-negative` | red    | `var(--destructive)` | `var(--destructive)` |

Worst all-pairs ΔE (OKLab ×100, protan / deutan simulation) over the five series: 12.9 light,
12.2 dark, both blue ↔ plum. Orange ↔ bronze is 14.1 light and 16.5 dark. Normal vision: at least
17.3 for every pair. Dark orange and teal sit above the validator's 0.67 lightness band for dark;
accepted, since that band is a style rule and every perceptual check passes (all dark marks
≥ 3:1 on a card). In light, orange is 2.8:1 on a card, under the 3:1 a mark should have. That is
accepted because the value is always written next to it (card, legend, tooltip). Positive and
negative can't be told apart by a colour-blind reader, so they always come with ▲ / ▼ and a sign.
Brick 5 uses slots 1 and 2 and the blue ramp. Slots 3 to 5 are there for later bricks.

### Tests

- Worker: the `activity` route (days validation, zone, period bounds ending yesterday, both calls
  made, mapping, `invalid_time_zone` → probe true, `PGRST202` → false), in the pattern of `test/router.test.ts` and
  `test/features.test.ts`.
- UI: the Activity section with a mocked API: off, loading, error and Retry, empty, data; the
  change shown with sign and arrow; unanswered shown without a change; the toggle refetches and keeps
  the old data meanwhile; a missing module hides its row. In the pattern of
  `test/scheduledWeek.test.tsx`.
- Pure helpers (change in % and points, period bounds) unit-tested.
- Manual: a local `wrangler dev` (any port except 8799) against the Unchaind sandbox with the
  migration applied, then a Playwright WebKit walkthrough video for the PR.

### Roadmap

In the SDK PR: brick 5's row moves to "in progress" when the work starts and to "done" with
"Shipped:" links. Its "SDK change" becomes "yes", and its text names the added numbers. The SDK
coverage row for `admin_daily_metrics` notes the rewrite and the release that carries it.

## Left to the builder

- The exact Bklit components and props, chart heights, spacing, and the stat cards' layout at
  narrow widths, within the order above. Guillaume will give feedback once he sees it running.
- How to write the SQL efficiently (CTEs or `execute`), as long as a 90-day call stays fast on
  the sandbox. Time it and report the time in the PR.
- Copy wording beyond the labels named here, in English, with no hint text under fields.
