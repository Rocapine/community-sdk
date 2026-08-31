# Integrating the Community SDK into an app

A phased, agent-oriented integration guide — the successor to the internal
Rocactopus mold's `SKILL.md`. Where the mold had you copy-paste files and
adapt four marked "seams", this SDK replaces that with an npm install, a CLI
run, and one `CommunityConfig` object. The phases below still map roughly
1:1 onto the mold's for anyone who worked with it before.

Work through the phases in order.

## Phase 0 — What you need before starting

- The host app: Expo (dev client recommended) + TypeScript, a React Query
  `QueryClientProvider` mounted somewhere above where you'll render community
  screens.
- A Supabase project for this app (its own — this SDK is not a shared
  backend). Note its project ref, URL, anon key, and service-role key.
- Secrets to have on hand: an OpenAI API key (moderation is **required**,
  there's no way to disable it), and — optionally — a Slack incoming webhook
  URL (report/moderation alerts; the SDK runs fine without it) and an Expo
  access token (only if you're shipping the push module on an
  Enhanced-Security project).
- Product decisions: the topic list, your app's voice for the community
  guidelines copy and anonymous-author fallback name, which optional modules
  you're shipping (push? polls? the reaction module, and if so what does it
  mean — cheer, prayer, support?).

## Phase 1 — Backend

1. **Enable anonymous sign-ins** — Supabase dashboard → Authentication →
   Sign In / Up → allow anonymous. Manual; no migration does this for you.
   Without it every community call resolves a null identity. See
   `docs/backend-runbook.md` for the CLI equivalent (`supabase config
   push` with `enable_anonymous_sign_ins = true` in `config.toml`).
2. From the app repo root:

   ```bash
   npx @rocapine/community init --modules core,push,polls,reaction,inbox
   ```

   Drop any module you don't want from `--modules` (`core` is always
   implied). This copies migrations into `supabase/migrations/` and Edge
   Functions into `supabase/functions/`, substituting the project
   URL/anon-key placeholders the three affected migrations carry (prompted
   interactively, or pass `--project-url`/`--anon-key`), and writes
   `community-sdk.json`.
3. Review the copied migrations, then:

   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
4. Set secrets and deploy:

   ```bash
   supabase secrets set OPENAI_API_KEY=... SLACK_WEBHOOK_URL=... \
     COMMUNITY_FALLBACK_NAME="<anon name fallback>" COMMUNITY_APP_NAME="<app name>" \
     EXPO_ACCESS_TOKEN=...   # push module only
   supabase functions deploy
   ```

   `COMMUNITY_FALLBACK_NAME` should equal the `anonymousAuthorFallback`
   you'll set in `CommunityConfig` (Phase 3) so pushes and UI agree on how
   an unnamed author is shown. Full secrets table:
   `docs/backend-runbook.md`.

## Phase 2 — Install the packages

```bash
npm install @rocapine/community-core @rocapine/community-ui
```

Install whichever peer deps you're missing —
`@supabase/supabase-js`, `@tanstack/react-query`,
`react-native-reanimated`, `expo-image`, `expo-haptics`,
`expo-image-picker`, `phosphor-react-native`. If the app already has a
Supabase client, reuse it for `CommunityConfig.supabase` rather than
creating a second one, but keep the settings the SDK needs: AsyncStorage
persistence, `persistSession: true`, and never call `supabase.auth.signOut()`
on your own app's sign-out flow if the anonymous identity should survive it
(the SDK's identity is a normal Supabase anonymous session — signing it out
destroys it).

## Phase 3 — Build `CommunityConfig` (the adaptation work)

This single object replaces every seam the old mold had you edit by hand:

1. **Topics & product vocabulary** — `topics`, `appName`,
   `anonymousAuthorFallback`. Keep any `id` you plan to make `officialOnly`
   consistent with what you'll insert official posts under. `news` is a
   reasonable convention but not reserved by the code — RLS enforces
   `officialOnly` per the ids *you* mark, not a fixed name.
2. **Modules** — mirror exactly what you installed on the backend in Phase
   1 (`modules.push`/`modules.polls`/`modules.inbox` booleans,
   `modules.reaction: { key: "..." } | false`).
3. **Theming** — pass a `theme` to `CommunityUIProvider` (see
   `packages/ui/README.md` for the full token list) instead of editing a
   `theme.tsx` file. Skip it to use the neutral default palette.
4. **Analytics** — `host.onEvent(name, props)` replaces the mold's 12 no-op
   helper functions in `services/community-analytics.ts`. Route every
   `COMMUNITY_EVENTS` name into your own tracking plan. Privacy rule
   (carried over from the mold): never send post/comment/bio text as event
   properties — lengths and counts only.
5. **Host adapters** — `host.getDisplayName`, `host.getAnalyticsIds`,
   `host.rulesAcceptance`, `host.onContentPublished`, `host.getLocale`
   replace the mold's `lib/community-host.ts` store. Wire each to your own
   user store; leave any you don't need unset (they default to safe no-ops).
6. **i18n overrides** — pass `translations: { locale, overrides }` to
   `CommunityUIProvider` for app-specific copy (e.g. renaming the reaction,
   your own guidelines wording, a branded topic label under
   `topics.<yourId>`). See `packages/ui/README.md`'s i18n section for
   lookup order and the `COMMUNITY_REACTION_PUSH_TEXT` single-locale-override
   caveat if you use the reaction module.

## Phase 4 — Wire the provider and screens

```tsx
<QueryClientProvider client={queryClient}>
  <CommunityProvider config={config}>
    <CommunityUIProvider theme={theme} translations={translations}>
      {/* mount CommunityFeedScreen, ProfileScreen, NotificationInboxScreen,
          ThreadSheet in your own router — see examples/expo-app/App.tsx */}
    </CommunityUIProvider>
  </CommunityProvider>
</QueryClientProvider>
```

- **Entry point**: a button/tile navigating to your community screen. If
  you shipped the inbox module, `useCommunityUnseenCount` (core) or
  `NotificationInboxScreen`'s own unread state gives you a badge count.
- **Settings/profile screen**: `ProfileEditSheet` covers username/bio/avatar
  moderated editing; the avatar can double as your app's own profile photo
  if you read it back through `useProfile(useMyUid())`.
- **Push module**: register the device's Expo push token against
  `push_tokens` (see the `push` migration's schema) and route incoming
  notification taps whose payload `data.route` targets your community
  screen; fire your own `notification_opened`-equivalent analytics event
  from the tap handler.
- **`app.config`**: if you use `ProfileEditSheet`'s avatar picker, set
  `expo-image-picker`'s `photosPermission` string to mention the community
  profile picture — App Review reads this copy.

## Phase 5 — Moderation dashboard

The `core` migrations include `community_dashboard`
(`admin_users`, `moderation_actions`, aggregation views, a metrics RPC) so
any admin tool — including a private one — can plug into your installed
backend. Rocapine's own hosted dashboard (Rocactopus) is internal and not
part of this SDK. Without a dashboard, moderate via SQL or Supabase Studio's
table editor: set `posts.status` / `comments.status` to `hidden` (never
`DELETE` a row — the schema's convention is `visible` / `hidden` /
`deleted`, all soft states).

## Phase 6 — QA checklist

Run through on a simulator/device against your real (or a scratch) project:

1. First open → anonymous identity created, a `profiles` row exists with a
   handle.
2. First post attempt → the rules sheet gates; accept → composer; publish →
   the post appears once moderation resolves it (`moderate-one` runs
   inline; a post is briefly `pending`, then `visible` or stays `hidden`).
3. Publish something a moderation model would flag → rejected notice, the
   post stays hidden — never reaches the feed.
4. Comment, like, poll vote (if `polls`), reaction (if `reaction`) —
   optimistic UI, counts correct.
5. Profile: set username/bio/avatar → the moderated write path works;
   rejected content shows the appropriate notice.
6. Report a post → Slack alert if `SLACK_WEBHOOK_URL` is set (a logged
   no-op otherwise); block an author → their content disappears from your
   view.
7. Push (if shipped): comment/like/reaction from a second account → push
   received, tap routes correctly.
8. Notification inbox (if shipped): the events above show up as inbox rows;
   opening it clears the unread badge.
9. `pnpm test` (or your own runner) on the app's own tests still passes —
   this SDK's own unit tests live in `packages/core`/`packages/ui` and don't
   need re-running per host app.

## Maintenance discipline

- SDK updates are opt-in per app: `npx @rocapine/community upgrade` copies
  any new migrations/functions since your `community-sdk.json` was written;
  review, `supabase db push`, redeploy touched functions, ship.
- Never renumber or edit an already-applied migration — a new behavior
  ships as a new migration file, always.
- If you're adopting a backend that predates this SDK (built from the old
  mold, or hand-rolled), use `npx @rocapine/community adopt
  --schema-version <n> --modules <...>` instead of `init` — it registers the
  manifest without copying any file. See `packages/cli/README.md` and
  `docs/compat.md`.
