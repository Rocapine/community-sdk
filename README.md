# Community SDK

A drop-in social/community layer for React Native (Expo) apps: a feed with
topics and search, threaded comments, likes, a generic "reaction" (a second,
private engagement signal beyond like — think prayers, cheers, support),
polls, moderated profiles (username/bio/avatar), AI moderation
(moderate-before-publish + a daily sweep), a notification inbox, push
notifications, and blocks/reports.

It ships as three npm packages plus a versioned Supabase backend:

| Package                                                                          | What it is                                                                                               | Peer deps                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@rocapine/community-core`](packages/core/README.md)                            | Headless: config, models, Supabase queries, React Query hooks, anonymous identity, analytics event names | `react`, `@supabase/supabase-js`, `@tanstack/react-query`                                                                                                                                                                                              |
| [`@rocapine/community-ui`](packages/ui/README.md)                                | Themable screens and components (feed, thread, profile, inbox)                                           | the above, plus `react-native`, `react-native-reanimated`, `@gorhom/bottom-sheet`, `react-native-gesture-handler`, `react-native-safe-area-context`, `expo-image`, `expo-haptics`, `expo-image-picker`, `phosphor-react-native` (optional — see below) |
| [`@rocapine/community`](packages/cli/README.md) (CLI, `npx @rocapine/community`) | Installs/upgrades the Supabase backend: migrations + Edge Functions                                      | none (Node CLI)                                                                                                                                                                                                                                        |

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
`@gorhom/bottom-sheet`, `react-native-gesture-handler`,
`react-native-safe-area-context`, `expo-image`, `expo-haptics`, `expo-image-picker`, `phosphor-react-native`)

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
supabase secrets set COMMUNITY_TRANSLATION_LOCALES=en,es-419   # translation module only
supabase functions deploy
```

Full backend setup (anonymous sign-ins, all secrets, cron verification):
[`docs/backend-runbook.md`](docs/backend-runbook.md).

### 3. Pin React Query in Metro

The SDK's compiled CommonJS `require()`s `@tanstack/react-query`, while your
app `import`s it. Metro's `exports` resolution then loads two copies of it, and
the SDK throws "No QueryClient set" even though your provider is in place. Pin
the package to a single file in `metro.config.js` (see
[`docs/integration.md`](docs/integration.md) → Phase 2 for the snippet).

### 4. Wire the provider

This is the exact shape used by [`examples/expo-app/App.tsx`](examples/expo-app/App.tsx)
(a working, live-verified reference app — run it with `npm start -w
@rocapine/community-example-expo-app`):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommunityProvider, type CommunityConfig } from "@rocapine/community-core";
import { CommunityFeedScreen, CommunityUIProvider } from "@rocapine/community-ui";
import { createClient } from "@supabase/supabase-js";

const queryClient = new QueryClient();

const config: CommunityConfig = {
  supabase: createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_KEY!,
  ),
  appName: "My App",
  anonymousAuthorFallback: "Someone",
  topics: [{ id: "general" }, { id: "question" }, { id: "news", officialOnly: true }],
  modules: {
    polls: true,
    push: false,
    inbox: true,
    reaction: { key: "cheer" },
    // must equal the backend's COMMUNITY_TRANSLATION_LOCALES secret
    translation: { locales: ["en", "es-419"] },
  },
  host: {
    onEvent: (name, props) => myAnalytics.track(name, props),
  },
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CommunityProvider config={config}>
        <CommunityUIProvider theme={{ colors: { accent: "#6C4DF6" } }}>
          <CommunityFeedScreen
            onOpenProfile={(userId) => {
              /* navigate */
            }}
          />
        </CommunityUIProvider>
      </CommunityProvider>
    </QueryClientProvider>
  );
}
```

`supabase: null` runs the SDK in **degraded mode**: every screen renders its
empty state (queries stay disabled), one console warning is logged the first
time a mutation needs the client, and nothing crashes — useful for `expo start` with no `.env` yet.

Full config reference (host adapters, degraded mode, event names):
[`packages/core/README.md`](packages/core/README.md). Theming, i18n and
icon overrides: [`packages/ui/README.md`](packages/ui/README.md).

**Bring your own icons:** not every app uses `phosphor-react-native` (an
optional peer of `@rocapine/community-ui`, not a hard dependency). Pass a
partial `icons` map to `CommunityUIProvider` to override any of the
package's semantic icon roles with another library, e.g.:

```tsx
import { Feather } from "@expo/vector-icons";

<CommunityUIProvider
  icons={{ like: ({ size, color }) => <Feather name="heart" size={size} color={color} /> }}
>
  {/* unset roles fall back to the built-in phosphor-backed defaults */}
</CommunityUIProvider>;
```

## Module matrix

`modules` in `CommunityConfig` must mirror what the CLI installed on the
backend (`--modules` at `init` time / `community-sdk.json`).

| Module      | Config field                                          | Adds                                                                                                                                                                                                                                 | Backend pieces                                                                                                         |
| ----------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| core        | always on                                             | feed, comments, likes, blocks/reports, moderated profiles (handle/bio/avatar synchronously, username by the daily sweep)                                                                                                             | `supabase/migrations/core/*`, `moderate-one`, `daily-moderation`, `update-profile`, `report-to-slack`                  |
| push        | `modules.push: boolean`                               | like/comment push notifications, official-account broadcasts                                                                                                                                                                         | `supabase/migrations/push/*`, `notify-like`, `notify-comment`, `broadcast-post`                                        |
| polls       | `modules.polls: boolean`                              | 2-4 option polls on a post                                                                                                                                                                                                           | `supabase/migrations/polls/*`                                                                                          |
| reaction    | `modules.reaction: { key: string } \| false`          | one generic, private, non-retractable secondary reaction per post (label/meaning is entirely client-side via i18n + `renderReactionButton`)                                                                                          | `supabase/migrations/reaction/*`, `notify-reaction`                                                                    |
| inbox       | `modules.inbox: boolean`                              | server-event notification center (likes/comments/reactions/official posts, plus custom app-defined kinds)                                                                                                                            | `supabase/migrations/inbox/*`                                                                                          |
| translation | `modules.translation: { locales: string[] } \| false` | posts, comments and poll labels translated at publication into the listed locales, shown in the reader's language with a per-item "see original"; comment pushes, official broadcasts and inbox excerpts in the recipient's language | `supabase/migrations/translation/*`, `translate-one`, `daily-translation` (+ `notify-comment`/`broadcast-post` use it) |

**Ordering note:** the CLI installs modules `core → push → polls → reaction →
inbox → translation` regardless of the order you pass to `--modules`, because inbox's
reaction trigger is guarded at install time and needs the reaction module's
table to already exist. You never need to think about this — just don't
enable `inbox` without `reaction` if you want reaction pushes to show up in
the inbox (the CLI warns if you do). Already initialized a backend and just
want to add one more module? `npx @rocapine/community upgrade --add-modules
translation` installs it on top of the existing backend (and applies any other
pending upgrade: new migrations, changed function templates).

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

- [`docs/integration.md`](docs/integration.md) — the end-to-end integration
  guide, phase by phase (backend, packages, config, screens, QA). In
  Rocapine repos, the `/roca-features:community` skill runs it for you.
- [`docs/backend-runbook.md`](docs/backend-runbook.md) — every secret,
  anonymous sign-ins, cron verification, `db push` flow.
- [`docs/compat.md`](docs/compat.md) — SDK version ↔ schema version
  compatibility table.
- [`packages/core/README.md`](packages/core/README.md),
  [`packages/ui/README.md`](packages/ui/README.md),
  [`packages/cli/README.md`](packages/cli/README.md) — per-package reference.
- Design history: [`docs/design-spec.md`](docs/design-spec.md) and
  [`docs/implementation-plan.md`](docs/implementation-plan.md) — the spec and
  task-by-task plan that shaped this repo, kept for provenance.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

`examples/expo-app` is the manual/QA bench — see its own README-less
`package.json` (`npm start -w @rocapine/community-example-expo-app`).
There are no automated UI tests in v1; the example app plus `docs/backend-runbook.md`'s
QA checklist are the coverage story for anything React Native rendering
touches. `packages/core` and `packages/ui` each have vitest unit tests
(`npm test`).

## Maintainers: releasing

Versions are managed with [changesets](https://github.com/changesets/changesets).
The three packages form a `linked` group: when several of them are released
together, they share the highest version. A package with no changeset stays
where it is.

1. **Every PR** that changes a package adds a changeset (`npx changeset`):
   patch for a fix, minor for a feature or a new peer dependency (we are in 0.x).
2. **Release PR:** on a `release/<package>-<version>` branch, run
   `npx changeset version`, which bumps the versions, writes the CHANGELOGs and
   removes the changesets. Then `npm install --package-lock-only`, open the PR,
   review it and merge it.
3. **Publish** from an up-to-date `main`: `npm run release` (build +
   `changeset publish`). npm asks for web authentication (2FA): this is a manual
   step, not CI.
4. **Roll out to the apps.** Bump the packages in each app. If the release
   touches migrations or functions, run `npx @rocapine/community upgrade` in
   each app, then `supabase db push` and redeploy the functions it touched. Add
   a row to [`docs/compat.md`](docs/compat.md) for every release line.

A scratch Supabase project (`community-sdk-scratch`, ref
`cozfrhmbjrvotpwjnqmu`) is used for QA before a release.
