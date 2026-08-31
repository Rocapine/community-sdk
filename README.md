# Community SDK

A drop-in social/community layer for React Native (Expo) apps: a feed with
topics and search, threaded comments, likes, a generic "reaction" (a second,
private engagement signal beyond like — think prayers, cheers, support),
polls, moderated profiles (username/bio/avatar), AI moderation
(moderate-before-publish + a daily sweep), a notification inbox, push
notifications, and blocks/reports.

It ships as three npm packages plus a versioned Supabase backend:

| Package | What it is | Peer deps |
|---|---|---|
| [`@rocapine/community-core`](packages/core/README.md) | Headless: config, models, Supabase queries, React Query hooks, anonymous identity, analytics event names | `react`, `@supabase/supabase-js`, `@tanstack/react-query` |
| [`@rocapine/community-ui`](packages/ui/README.md) | Themable screens and components (feed, thread, profile, inbox) | the above, plus `react-native`, `react-native-reanimated`, `expo-image`, `expo-haptics`, `expo-image-picker`, `phosphor-react-native` |
| [`@rocapine/community`](packages/cli/README.md) (CLI, `npx @rocapine/community`) | Installs/upgrades the Supabase backend: migrations + Edge Functions | none (Node CLI) |

Why two runtime packages instead of one: a host that only wants the data
layer (a custom UI, a web admin, a bot) should not have to pull in
`react-native-reanimated` or `expo-image`. This mirrors how Stream/Sendbird
split their SDKs.

## Why

Rocapine had this exact feature built independently, twice, by copy-paste
from an internal "mold" — and it drifted every time (one app got a reaction
feature and a notification inbox the other never saw). This SDK is the
genericized, de-branded, single source of truth: install it, theme it, wire
five config fields and some host callbacks, and you have a moderated social
feed.

## 5-minute quickstart

### 1. Install

```bash
npm install @rocapine/community-core @rocapine/community-ui
```

(also needs the peer deps listed above if your Expo app doesn't already have
them: `@supabase/supabase-js`, `@tanstack/react-query`, `react-native-reanimated`,
`expo-image`, `expo-haptics`, `expo-image-picker`, `phosphor-react-native`)

### 2. Install the backend

From your app repo root (a Supabase project already linked, or about to be):

```bash
npx @rocapine/community init
```

This copies timestamped migrations and Edge Functions into `./supabase/`
and writes a `community-sdk.json` manifest. Then, as it prints:

```bash
supabase db push
supabase secrets set OPENAI_API_KEY=sk-...
supabase functions deploy
```

Full backend setup (anonymous sign-ins, all secrets, cron verification):
[`docs/backend-runbook.md`](docs/backend-runbook.md).

### 3. Wire the provider

This is the exact shape used by [`examples/expo-app/App.tsx`](examples/expo-app/App.tsx)
(a working, live-verified reference app — run it with `pnpm --filter
@rocapine/community-example-expo-app start`):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommunityProvider, type CommunityConfig } from "@rocapine/community-core";
import { CommunityFeedScreen, CommunityUIProvider } from "@rocapine/community-ui";
import { createClient } from "@supabase/supabase-js";

const queryClient = new QueryClient();

const config: CommunityConfig = {
  supabase: createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_KEY!),
  appName: "My App",
  anonymousAuthorFallback: "Someone",
  topics: [{ id: "general" }, { id: "question" }, { id: "news", officialOnly: true }],
  modules: { polls: true, push: false, inbox: true, reaction: { key: "cheer" } },
  host: {
    onEvent: (name, props) => myAnalytics.track(name, props),
  },
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CommunityProvider config={config}>
        <CommunityUIProvider theme={{ colors: { accent: "#6C4DF6" } }}>
          <CommunityFeedScreen onOpenProfile={(userId) => {/* navigate */}} />
        </CommunityUIProvider>
      </CommunityProvider>
    </QueryClientProvider>
  );
}
```

`supabase: null` runs the SDK in **degraded mode**: every screen renders its
empty state, one console warning is logged the first time a query needs the
client, and nothing crashes — useful for `expo start` with no `.env` yet.

Full config reference (host adapters, degraded mode, event names):
[`packages/core/README.md`](packages/core/README.md). Theming and i18n
overrides: [`packages/ui/README.md`](packages/ui/README.md).

## Module matrix

`modules` in `CommunityConfig` must mirror what the CLI installed on the
backend (`--modules` at `init` time / `community-sdk.json`).

| Module | Config field | Adds | Backend pieces |
|---|---|---|---|
| core | always on | feed, comments, likes, blocks/reports, moderated profiles | `supabase/migrations/core/*`, `moderate-one`, `daily-moderation`, `update-profile`, `report-to-slack` |
| push | `modules.push: boolean` | like/comment push notifications, official-account broadcasts | `supabase/migrations/push/*`, `notify-like`, `notify-comment`, `broadcast-post` |
| polls | `modules.polls: boolean` | 2-4 option polls on a post | `supabase/migrations/polls/*` |
| reaction | `modules.reaction: { key: string } \| false` | one generic, private, non-retractable secondary reaction per post (label/meaning is entirely client-side via i18n + `renderReactionButton`) | `supabase/migrations/reaction/*`, `notify-reaction` |
| inbox | `modules.inbox: boolean` | server-event notification center (likes/comments/reactions/official posts, plus custom app-defined kinds) | `supabase/migrations/inbox/*` |

**Ordering note:** the CLI installs modules `core → push → polls → reaction →
inbox` regardless of the order you pass to `--modules`, because inbox's
reaction trigger is guarded at install time and needs the reaction module's
table to already exist. You never need to think about this — just don't
enable `inbox` without `reaction` if you want reaction pushes to show up in
the inbox (the CLI warns if you do).

## Dashboard

A hosted moderation dashboard (Rocactopus) is used internally at Rocapine to
moderate every app's community from one place. It is **not** part of this
SDK and is not published. The schema does ship a `community_dashboard`
migration (`supabase/migrations/core/004_dashboard.sql` — `admin_users`,
`moderation_actions`, aggregation views, a metrics RPC) so any admin tool,
including your own, can plug into an installed backend the same way.
Without a dashboard, moderate via SQL or the Supabase Studio table editor —
`posts.status` / `comments.status` are `visible` / `hidden` / `deleted`, and
`hidden` is the moderation state (never `DELETE` a row; see
[`docs/backend-runbook.md`](docs/backend-runbook.md)).

## More docs

- [`docs/integration-skill.md`](docs/integration-skill.md) — a phased,
  agent-oriented integration guide (the "how do I actually wire this into my
  app end to end" walkthrough).
- [`docs/backend-runbook.md`](docs/backend-runbook.md) — every secret,
  anonymous sign-ins, cron verification, `db push` flow.
- [`docs/compat.md`](docs/compat.md) — SDK version ↔ schema version
  compatibility table.
- [`packages/core/README.md`](packages/core/README.md),
  [`packages/ui/README.md`](packages/ui/README.md),
  [`packages/cli/README.md`](packages/cli/README.md) — per-package reference.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`examples/expo-app` is the manual/QA bench — see its own README-less
`package.json` (`pnpm --filter @rocapine/community-example-expo-app start`).
There are no automated UI tests in v1; the example app plus `docs/backend-runbook.md`'s
QA checklist are the coverage story for anything React Native rendering
touches. `packages/core` and `packages/ui` each have vitest unit tests
(`pnpm -r test`).

## Maintainers: release checklist

Publishing is **gated on human confirmation** — do not run `pnpm release`
until every item below is checked.

1. **Confirm names with Martin.** The design spec (§9) marks the GitHub org
   (`Rocapine/community-sdk`) and npm scope (`@rocapine/community-core`,
   `@rocapine/community-ui`, `@rocapine/community`) as placeholders pending
   confirmation. If either changes, update every `package.json` `name` field
   and this README before publishing.
2. **npm org `@rocapine`** — confirm it exists, has 2FA enabled, and an
   `NPM_TOKEN` repo secret is set for CI to publish with.
3. **License** — `LICENSE` at the repo root is MIT; confirm that's still the
   intended license before the first publish.
4. **Create the GitHub repo and push.** Once §9's names are confirmed:
   create the repo, push this history, wire branch protection / CI as
   desired.
5. **Dry-run, then release:**
   ```bash
   pnpm publish -r --dry-run --no-git-checks
   # review the tarball contents/version list, then:
   pnpm release   # = pnpm build && changeset publish
   ```
6. **Post-release: full live QA.** The example app's degraded mode and
   non-moderation-gated paths were verified live during development, but
   everything downstream of moderation was blocked on a real
   `OPENAI_API_KEY` (not available in that environment). Before calling this
   production-ready:
   - `supabase secrets set OPENAI_API_KEY=sk-...` on the target project.
   - `supabase functions deploy` (all functions, including the
     moderation-gated ones).
   - Re-test post creation end to end: composer → POST → the post appears
     with `status: "visible"` (or the rejected-notice path with clearly
     flaggable content).
   - Comment, like, poll vote, reaction, block/report, and the notification
     inbox — none of these can be exercised without at least one genuinely
     `visible` post to hang off of.
   - Android (not covered by the development-time QA pass, iOS only).
   A scratch Supabase project used during development
   (`community-sdk-scratch`, ref `cozfrhmbjrvotpwjnqmu`) is available for
   reuse if still live.
