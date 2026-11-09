# Community SDK example app

An Expo SDK 58 app that runs the SDK from this repo's `packages/` (no publish needed)
against a real backend. Two tabs:

- **Community**: the feed, with profiles, the thread and the notification center.
- **Config**: every SDK option, applied live and kept across launches (AsyncStorage).
  Each SDK change that adds an option adds its control here.

## Backend

Supabase project **community-sdk-scratch** (`cozfrhmbjrvotpwjnqmu`), with every module
installed and every function deployed. It is a sandbox: anyone working on the SDK may
change its config, schema and content.

```bash
cp .env.example .env   # then fill both values
```

- `EXPO_PUBLIC_SUPABASE_URL`: `https://cozfrhmbjrvotpwjnqmu.supabase.co`
- `EXPO_PUBLIC_SUPABASE_KEY`: the project's publishable key
  (`npx supabase projects api-keys --remote=cozfrhmbjrvotpwjnqmu`)

Without them the app runs in degraded mode (empty states, one console warning).

To bring the backend up to date after a migration or function change, from the repo root:

```bash
npx supabase db query --remote=cozfrhmbjrvotpwjnqmu -f supabase/migrations/<module>/<file>.sql
```

```bash
npx supabase functions deploy --remote=cozfrhmbjrvotpwjnqmu --use-api
```

## Run

The app needs a development build (native modules). From this folder:

```bash
npx expo run:ios
```

```bash
npx expo start --port 8083
```

The app imports the SDK packages through the workspace, from their built `lib/`: run
`npm run build` at the repo root after changing `packages/core` or `packages/ui`, then
reload.
