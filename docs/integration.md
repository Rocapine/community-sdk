# Integrating the Community SDK into an app

The end-to-end recipe for wiring the SDK into an Expo app, in order. It is
the always-current version of the Rocapine `/roca-features:community`
feature-building skill, which walks an agent through the same phases. For
exact signatures, see the per-package READMEs.

## Phase 0 — Before starting

- **The host app:** Expo with a dev client (not Expo Go) and TypeScript. Mount a
  React Query `QueryClientProvider` somewhere above the community screens.
- **A Supabase project** of its own for this app. This SDK is not a shared backend.
  Note its project ref, URL and anon key.
- **Secrets:**
  - an OpenAI API key. Moderation is **required** and can't be turned off. With
    the translation module, the key also needs Responses (write) access.
  - optional: a Slack incoming-webhook URL for report and moderation alerts.
  - optional: an Expo access token, needed only for the push module on an
    Enhanced-Security Expo project.
- **Product decisions:**
  - the topic list and which topics are official-only;
  - the anonymous-author fallback name;
  - which optional modules you ship: push, polls, inbox, the reaction and what
    it means (cheer, prayer, support…), and translation into which locales.

## Phase 1 — Backend

1. **Enable anonymous sign-ins.** In the Supabase dashboard, go to
   Authentication → Sign In / Up and allow anonymous sign-ins, or set
   `enable_anonymous_sign_ins = true` in `config.toml`. No migration does this
   for you. Without it, every community call resolves a null identity.
2. **Copy the modules** from the app repo root:

   ```bash
   npx @rocapine/community init --modules core,push,polls,reaction,inbox,translation
   ```

   Drop any module you don't want (`core` is always implied; omitting the flag
   installs every module). This copies migrations into `supabase/migrations/`
   and Edge Functions into `supabase/functions/`, and writes
   `community-sdk.json`. Nothing project-specific is written into the
   migrations: the same files deploy to a sandbox and to production.

3. Review the copied migrations, then run `supabase db push`.
4. **Seed the project settings** — once per Supabase project, right after the
   push (the cron jobs and webhooks read the project URL / anon key from
   Vault; `init` prints this line filled in when you pass `--project-url` and
   `--anon-key`):

   ```bash
   supabase db query "select public.community_settings_set('https://<ref>.supabase.co', '<anon key>');"
   ```

5. Set the secrets and deploy the functions:

   ```bash
   supabase secrets set OPENAI_API_KEY=... SLACK_WEBHOOK_URL=... \
     COMMUNITY_APP_NAME="<app name>" COMMUNITY_FALLBACK_NAME="<anon name fallback>" \
     COMMUNITY_TRANSLATION_LOCALES=en,es-419 \
     EXPO_ACCESS_TOKEN=...
   supabase functions deploy
   ```

   - `COMMUNITY_TRANSLATION_LOCALES` is needed only for the translation module.
   - `EXPO_ACCESS_TOKEN` is needed only for the push module.
   - Two secrets must equal what the app sets in Phase 3:
     - `COMMUNITY_FALLBACK_NAME` must equal `anonymousAuthorFallback`;
     - `COMMUNITY_TRANSLATION_LOCALES` must equal `modules.translation.locales`.

     Otherwise pushes and the UI disagree.

   - The full secrets table and the cron jobs are in
     [`backend-runbook.md`](backend-runbook.md).

## Phase 2 — Packages

```bash
npm install @rocapine/community-core @rocapine/community-ui
npx expo install @supabase/supabase-js @tanstack/react-query react-native-reanimated \
  @gorhom/bottom-sheet react-native-gesture-handler react-native-safe-area-context \
  expo-image expo-haptics expo-image-picker phosphor-react-native
```

- **Install only the peers the app is missing.** `phosphor-react-native` is optional
  if you pass a full `icons` map. Any new native peer (reanimated,
  gesture-handler, image-picker…) means a new native build.
- **Pin `@tanstack/react-query` in Metro. This is mandatory.** The SDK ships
  CommonJS and `require()`s React Query, while the app `import`s it. Metro's
  `exports` resolution then loads **two** copies (`index.cjs` and `index.js`),
  so the SDK's hooks never see the app's `QueryClientProvider`. The result is
  "No QueryClient set" on mount, even though the tree is correct. Pin the bare
  specifier to one file in `metro.config.js`:

  ```js
  const path = require("path");
  const { getDefaultConfig } = require("expo/metro-config");
  const config = getDefaultConfig(__dirname);
  const REACT_QUERY = path.join(
    __dirname,
    "node_modules/@tanstack/react-query/build/modern/index.js",
  );
  const resolve = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (ctx, name, platform) =>
    name === "@tanstack/react-query"
      ? { type: "sourceFile", filePath: REACT_QUERY }
      : (resolve ?? ctx.resolveRequest)(ctx, name, platform);
  module.exports = config;
  ```

  (`examples/expo-app` uses `resolver.unstable_enablePackageExports = false`
  instead, which is blunter: it turns `exports` off for every package.)

- **Reuse the app's Supabase client** if it has one. Keep AsyncStorage
  persistence and `persistSession: true`. Never call `supabase.auth.signOut()`
  in the app's own sign-out if the anonymous community identity should survive
  it.

## Phase 3 — `CommunityConfig`

One object holds all of the app's choices; see
[`packages/core/README.md`](../packages/core/README.md). Build it in one module,
e.g. `lib/community-config.ts`.

1. **Vocabulary.** Set `topics`, `appName` and `anonymousAuthorFallback`.
   `officialOnly` topics are writable only by `is_official` profiles, enforced
   by RLS on the ids you mark. If the fallback name is localized, rebuild the
   config when the app language changes (a `useMemo` keyed on the language).
2. **Modules.** Mirror exactly what Phase 1 installed: the `push`, `polls` and
   `inbox` booleans, `reaction: { key } | false`, and
   `translation: { locales } | false`.
3. **Host adapters.** Every field is optional and defaults to a no-op.
   - `getDisplayName` must be **synchronous**: read an already-hydrated store.
   - `getAnalyticsIds` must also be synchronous. The providers' own getters are
     async, so warm a cache at startup with `Promise.allSettled`.
   - `rulesAcceptance` persists the one-time guidelines acceptance.
   - `onContentPublished` fires after a publish, e.g. to arm a review prompt.
   - `getLocale` returns the app language. It is resolved against
     `modules.translation.locales` to choose the reader's language, and
     `syncProfileFromHost()` mirrors it to `profiles.locale`, which the push
     functions use to write in each recipient's language.
4. **Analytics.** `host.onEvent(name, props)` is the only analytics seam. Map
   each `COMMUNITY_EVENTS` name to the app's tracking plan. Don't forward an
   event the app already tracks itself; that double-counts. Never send
   post, comment or bio text as a property; lengths and counts only.
5. **Identity.** At startup, call `ensureIdentity(cfg)`, then
   `syncProfileFromHost(cfg)` whenever the display name or the language changes.
   Both take the resolved config: `const cfg = resolveConfig(config)` in a
   module-scope singleton, for code that runs outside the React tree.
6. **Theme, i18n and icons** go on `CommunityUIProvider`: `theme`,
   `translations: { locale, overrides }` and `icons`. See
   [`packages/ui/README.md`](../packages/ui/README.md).

## Phase 4 — Provider and screens

```tsx
<QueryClientProvider client={queryClient}>
  <CommunityProvider config={config}>
    <CommunityUIProvider theme={theme} translations={translations} icons={icons}>
      {/* mount CommunityFeedScreen, ProfileScreen, NotificationInboxScreen and
          one ThreadSheet in your own router — see examples/expo-app/App.tsx */}
    </CommunityUIProvider>
  </CommunityProvider>
</QueryClientProvider>
```

- **Screens.** Navigation goes through callback props (`onOpenProfile`,
  `onOpenThread`, `onOpenPost`…). The SDK depends on no router. The sheets
  (thread, report, rules, profile edit) bring their own
  `GestureHandlerRootView` and safe-area provider, so there is nothing more to
  mount.
- **Entry-point badges.** `useCommunityUnseenCount(lastSeenAtIso)` gives the "new
  posts" dot, and `useUnreadNotificationCount()` gives the inbox count. If the
  screen stays mounted across tab switches (native tabs), stamp the last-seen
  watermark on focus, not on mount.
- **Profile.** `ProfileEditSheet` handles the moderated username, bio and avatar.
  If you use the avatar picker, set `expo-image-picker`'s `photosPermission` to
  mention the community profile photo; App Review reads this text.
- **Push module.** The SDK doesn't register the device. The app upserts its
  Expo push token into `push_tokens` (`user_id` = the community uid,
  `expo_push_token`, `notify_*` preferences) after permission is granted. It
  also routes notification taps: the payload has `data.route: "/community"`
  and `data.kind`.

## Phase 5 — Moderation

The `core` migrations include `community_dashboard` (`admin_users`,
`moderation_actions`, aggregation views, a metrics RPC), so any admin tool can
connect. Rocapine's Rocactopus dashboard is internal. Without a dashboard,
moderate through SQL or Supabase Studio: set `posts.status` or
`comments.status` to `hidden`. Never `DELETE` a row.

## Phase 6 — QA checklist

On a dev client, against the real project or a scratch one:

1. **Identity.** On first open, the anonymous identity is created and a `profiles`
   row exists.
2. **Posting.** The first post opens the rules sheet; accept it, then publish.
   The post shows up once moderation passes it. Flaggable content gets the
   rejection notice and never reaches the feed.
3. **Interactions.** Test comment, like, poll vote and reaction. The UI updates
   optimistically and the counts are right.
4. **Thread sheet.**
   - It closes with a swipe down on the handle.
   - With the keyboard up, the input stays above the keyboard and the whole
     thread still scrolls.
   - Report opens from a post's or a comment's menu.
5. **Translation.** With the app in another listed language, a post by another
   user shows "Translated from…". The "see original" toggle animates the change
   in height.
6. **Profile.** Setting username, bio and avatar goes through moderation.
7. **Report and block.** A report sends a Slack alert if the webhook is set. A block
   hides that author's content.
8. **Push and inbox.** Actions from a second account arrive as pushes, and
   tapping one routes to the community screen. The inbox shows the events and
   clears the badge.
9. **The app's own tests** still pass.

## Maintenance

- **Upgrades are per app.**
  - Bump the npm packages.
  - `npx @rocapine/community upgrade` copies the new migrations and changed
    function templates since `community-sdk.json`. Review them, `supabase db push`,
    then redeploy the functions it touched.
  - `upgrade --add-modules <m>` adds a module.
  - [`compat.md`](compat.md) says which releases carry backend changes.
- **Never renumber or edit a migration that has been applied.** New behaviour
  always ships as a new file.
- **A backend that predates the SDK** is registered with
  `npx @rocapine/community adopt --schema-version <n> --modules <…>` instead of
  `init`. See [`packages/cli/README.md`](../packages/cli/README.md).
