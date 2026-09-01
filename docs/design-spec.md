# Community SDK — Design Spec

> Historical document: this is the design spec that shaped this repo, written before it existed and imported here for provenance. It predates the repo (see `docs/implementation-plan.md` for how it was built) and is kept as-is except for reference cleanup — it is not kept up to date as the SDK evolves. For current behavior, see the package READMEs and `docs/compat.md`.

Date: 2026-08-31
Status: validated in brainstorming with Martin (audience, scope, packaging, adoption, backend distribution, modules, repo all decided in chat).

## 1. Goal

Turn the Rocactopus community "mold" (`Rocacommu/sdk/`, v1 extracted from Eve's Rhythm on 2026-07-29, consumed by copy-paste in Nightward) into a **public, open-source npm SDK** that any React Native developer can install, and that both Eve's Rhythm and Nightward adopt in production (deleting their local copies).

What this replaces: the current distribution model is disciplined copy-paste with documented "seams" (theme, topics, analytics, host). It works internally but drifts (Eve added prayers, the notification inbox, ComposerCard, unseen-count badge and it/pl i18n without backporting), and it is not publishable.

Out of scope, decided:

- The Rocactopus dashboard stays **private**. The public SDK covers the RN client + the Supabase backend (including the `community_dashboard` migration that creates `admin_users`, so the private dashboard keeps working against SDK-installed backends). External developers moderate via SQL / Supabase Studio at first.
- Articles CMS and home callouts stay app/dashboard extras, outside the SDK.
- Nightward's seed-content system stays in Nightward (candidate optional module later).
- Eve's AI prayer flow (`PrayForSisterSheet`, Rocai) stays in Eve, plugged into an SDK slot.

## 2. Repo and packages (Approach A)

New public GitHub repo (e.g. `Rocapine/community-sdk`), pnpm monorepo, npm scope `@rocapine`:

```
community-sdk/
├── packages/core        → @rocapine/community-core   (headless)
├── packages/ui          → @rocapine/community-ui     (themable screens/components)
├── packages/cli         → npx @rocapine/community    (backend init/upgrade/adopt)
├── supabase/            → versioned migrations + Edge Functions (source for the CLI)
│   ├── migrations/{core,push,polls,inbox,reaction}/
│   └── functions/       moderate-one, daily-moderation, update-profile,
│                        notify-comment, notify-like, notify-reaction,
│                        report-to-slack, broadcast-post, _shared/
├── examples/expo-app    → minimal Expo demo app (manual/Argent QA bench)
└── docs/                → integration guide (SKILL.md heritage), backend runbook
```

Rationale for two runtime packages: a headless consumer must not inherit the UI's peer deps (reanimated, expo-image, phosphor). This is the Stream/Sendbird model RN developers already know. Packages are versioned **together** (linked versioning via changesets).

Once the repo exists, `Rocacommu/sdk/` is deleted and replaced by a pointer to the public repo.

## 3. `@rocapine/community-core` (headless)

Content: the current `lib/community*.ts`, `constants/community.ts` limits, `services/community.ts`, `services/notification-center.ts`, `hooks/useCommunity.ts`, `hooks/useNotificationCenter.ts`, anonymous identity (`lib/community-identity.ts`) — genericized as below. Peer deps: `@supabase/supabase-js`, `@tanstack/react-query`, `react`. No components, no store, no router, no analytics provider.

### 3.1 `CommunityConfig` — the single configuration contract

Every product opinion or seam identified in the two apps becomes a field of one config object passed to a `CommunityProvider` at the app root:

```ts
type CommunityConfig = {
  // Connection — injected, never created by the SDK.
  // null ⇒ degraded mode (Nightward pattern): hooks return empty states, no crash,
  // one logged warning. The app boots normally without a backend.
  supabase: SupabaseClient | null;

  // Product vocabulary
  appName: string; // pushes, inbox ("Eve's Rhythm")
  anonymousAuthorFallback: string; // "A sister" (Eve) / "Wanderer" (Nightward)

  // Topics — nothing hardcoded. Labels come from i18n keys `topics.<id>` (UI layer).
  topics: Array<{ id: string; officialOnly?: boolean }>;

  // Opt-in modules; must mirror the backend modules installed by the CLI.
  modules: {
    polls: boolean;
    push: boolean;
    inbox: boolean;
    reaction: { key: string } | false; // e.g. { key: "prayer" }; semantics in §6
  };

  // Host adapters — all optional, no-op defaults.
  host: {
    getDisplayName?: () => string | null; // replaces reading Eve's onboarding store
    getAnalyticsIds?: () => { amplitudeId?: string; revenuecatId?: string };
    onEvent?: (name: CommunityEventName, props: object) => void; // single analytics callback
    rulesAcceptance?: { get(): Promise<boolean>; set(): Promise<void> };
    onContentPublished?: () => void; // Eve plugs armReviewGate here
    getLocale?: () => string;
  };
};
```

Key decisions:

- **Analytics = one `onEvent` callback.** The ~13 current event names ship as exported constants (`COMMUNITY_EVENTS`). The SDK never depends on Amplitude or any provider; Eve maps `onEvent` to its tracking-plan, an external dev routes or ignores it.
- **Anonymous identity stays in core** (`ensureIdentity()`, `useCommunityIdentity()`, reset on account login) operating on the injected client. In Eve this identity became the app-wide identity (referral, feedback, support, push all use it); the SDK therefore exposes it as public API and only guarantees "an anonymous session exists". Profile enrichment (amplitude/revenuecat ids, locale, username sync) runs through the host adapters.
- **No Zustand in the SDK.** Eve's store fields become either React Query state (unseen badge, driven by a `lastSeenAt` the app persists through an adapter) or adapters (`rulesAcceptance`).
- Models (`FeedPost`, `ThreadComment`, `CommunityProfile`, `FeedPoll`) and mirrored DB limits (`POST_MAX_LENGTH`, `COMMENT_MAX_LENGTH`, `POLL_*`) are exported unchanged — they are already pure.
- Existing unit tests (`lib/community.test.ts`, `lib/community-feed.test.ts`) move into core (vitest).

## 4. `@rocapine/community-ui` (themable)

Delivered as **components, not routes** — the app mounts them in its own screens/router: `CommunityFeedScreen`, `ThreadSheet`, `ComposerCard`, `ProfileScreen`, `ProfileEditSheet`, `NotificationInboxScreen`, `ReportSheet`, `RulesSheet`, `PollBlock`, `NoticeCard`.

- **Navigation by callbacks** (`onOpenProfile(userId)`, `onOpenThread(postId)`, …). No dependency on expo-router or react-navigation.
- **Theme by tokens**: a `CommunityTheme` (semantic palette ~15 colors, 3 font families, radius, spacing scale) passed to a UI provider; neutral default shipped. Eve/Nightward fill it from their design systems.
- **Slots** for heavy customization points: `renderPostFooter`, `renderComposerExtra`, `renderReactionButton` (how Eve keeps `PrayForSisterSheet` on top of the generic reaction), `renderInboxRow` (custom inbox kinds, §6).
- **i18n injectable, framework-free**: catalogs ship as plain objects (the 7 existing locales, cleaned of gendered vocabulary); the app passes `translations: { locale, overrides? }`; internal `t(key, params)`. Eve overrides ~10 keys ("A sister", "Eve's News", …). Topic labels resolve via `topics.<id>` keys that the app supplies for custom topics.
- **Assumed peer deps**: `react-native-reanimated`, `expo-image`, `expo-haptics`, `phosphor-react-native` (icons deliberately not injectable in v1).
- **Sheets**: the SDK ships its own self-contained sheet component (replacing `EveSheet`), so consumer apps need no sheet machinery. (Confirmed choice over a `renderSheet` slot.)

## 5. Backend distribution — versioned SQL + CLI

`supabase/` in the repo is the source of truth, organized by module (core is the clean consolidation of Eve's 17 migrations; push/polls/inbox/reaction are opt-in).

CLI commands:

- `init` — prompts for modules, copies migrations (re-prefixed with a current timestamp) and Edge Functions into the app's `supabase/`, writes a `community-sdk.json` manifest (installed schema version + modules). The dev runs `supabase db push` / `functions deploy` themselves.
- `upgrade` — diffs the manifest against the package version; copies only new migrations/functions.
- `adopt` — for Eve and Nightward: writes the manifest at the correct version **without copying already-applied migrations**.

**Hardcoded URL/JWT fix** (4 Eve migrations embed the project URL + anon JWT in pg_net crons/webhooks): shipped migrations contain `__SUPABASE_PROJECT_URL__` / `__SUPABASE_ANON_KEY__` placeholders; `init` substitutes them (prompted, or read from `supabase/config.toml`); a SQL guard at the top of each such migration raises if a placeholder survives. This is the pattern already proven by Nightward's runbook. No settings table, no Vault in v1.

**Edge Function configuration via secrets** (extends the mold's existing `COMMUNITY_APP_NAME` / `COMMUNITY_FALLBACK_NAME`):

- `OPENAI_API_KEY` — required for moderation.
- `SLACK_WEBHOOK_URL` — **optional**; without it, report-to-slack and moderation summaries become logged no-ops.
- Moderation opinions become settings with sane defaults: `MODERATION_EXCLUDED_CATEGORIES` (Eve sets `sexual*` for intimacy/TTC discussions), score threshold.

## 6. Module designs

### Reaction (generalization of Eve's prayers)

One secondary reaction per app, Eve's semantics kept: private rows, non-retractable, aggregate via a security-definer RPC returning count + last reactant's display name. Backend: table `post_reactions`, RPC `post_reaction_summary`, `notify-reaction` Edge Function (push text localized via the profile locale / function secrets). The **meaning** is 100% client-side: `modules.reaction = { key: "prayer" }` + i18n label + `renderReactionButton` slot; the core exposes `useReactToPost()`.

Eve's adoption requires a local migration renaming `post_prayers` → `post_reactions` and `post_prayer_summary` → `post_reaction_summary` (data preserved). ⚠️ Coordinate with Rocactopus if the dashboard reads these objects (verify during planning).

### Inbox (backport of Eve's notification center)

Direct backport of the `notifications` / `notification_seen` tables, triggers, `list_notifications()` RPC (union with official posts) and 90-day purge, generalized on two points:

1. Standard kinds are `like` / `comment` / `reaction` / `official_post`.
2. The table accepts **custom kinds inserted by service-role** (Eve's `support_reply` becomes an app-defined kind), rendered through the `renderInboxRow` slot when unknown to the SDK.

### Push and polls

Carried over from mold v1 as-is (already opt-in), with the reaction push added.

## 7. Adoption plan (order of operations)

1. **Consolidation** (in the new repo, not in the apps): initialize from `Rocacommu/sdk/` v1, backport Eve's drift (reaction/prayers, inbox, unseen-count badge, ComposerCard, it/pl i18n) and Nightward's improvements (nullable Supabase client with graceful degradation, key-based i18n, storeless host seam, setup runbook). This is the bulk of the genericization work.
2. **Packages + CLI + example app**, publish `0.x`.
3. **Nightward migrates** (closest to the mold): delete copied files, install packages, config + theme, CLI `adopt`.
4. **Eve migrates**: same, plus the reaction rename migration and the slots (`PrayForSisterSheet`, `support_reply`). This is the rich-case test.
5. **Rocacommu**: delete `sdk/`, leave a pointer. Dashboard unchanged (same tables), modulo the reaction rename check above.
6. Publish `1.0` once both apps run on it in production.

## 8. Versioning, testing, docs, CI

- **pnpm monorepo + changesets**, linked versioning (core/ui/cli share one version).
- **npm ↔ schema compatibility**: each package version declares its minimum schema version; the core migration maintains `community_meta(schema_version)`; core checks it at startup **in dev only** (console warning on mismatch). The CLI manifest plus a compat table in the README cover the rest.
- **Testing**: core unit tests (vitest, migrated from Eve). The example Expo app is the manual/Argent QA bench for UI. No automated SQL tests in v1.
- **Docs**: README per package; a phased integration guide inheriting the mold's `SKILL.md` (an agent-oriented install guide is kept deliberately — it is a differentiator); backend runbook inheriting Nightward's `docs/community-setup.md`.
- **CI**: GitHub Actions — typecheck, tests, build; releases via changesets under `@rocapine`.

## 9. Open items for the implementation plan

- Exact npm package/repo names (placeholder: `Rocapine/community-sdk`, `@rocapine/community-*`).
- Whether the Rocactopus dashboard reads `post_prayers` (metrics), to sequence Eve's rename.
- npm org `@rocapine`: existence/ownership, 2FA, publish tokens.
- License choice (MIT assumed, not yet confirmed).
