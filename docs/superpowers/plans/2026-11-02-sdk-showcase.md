# Community SDK Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a ~80–90 s 16:9 video, a 1920×1080 bento PNG and a Slack draft that show the Community SDK's modularity through eight reskinned Rocapine apps and the real Unchaind community.

**Architecture:** One Expo app (from `~/Developer/app-template`) that renders the SDK under eight runtime-switchable skins, each a typed `Skin` object (config + theme + icons + translations + render slots). A Node seed script wipes and refills `community-sdk-scratch` with one skin's content before that skin is filmed. Footage is recorded full-screen with Argent on one iOS simulator; close-ups are crops in the edit (HyperFrames); the bento is an HTML composition of crops exported to PNG.

**Tech Stack:** Expo SDK 55, React 19, `@rocapine/community-core` / `@rocapine/community-ui` 0.14.1, Supabase (CLI 2.122, `db query --linked -f`), Node 22 ESM scripts, Argent (iOS simulator), HyperFrames, ffmpeg.

**Spec:** `docs/superpowers/specs/2026-11-02-sdk-showcase-design.md` (approved 2026-11-02). Read it first; this plan only adds the build decisions.

## Global Constraints

- SDK: `@rocapine/community-ui@0.14.1`, `@rocapine/community-core@^0.14.0`. No SDK patches: an option that doesn't work is dropped or moved to another skin.
- Skins write only to `community-sdk-scratch` (`cozfrhmbjrvotpwjnqmu`). The Unchaind finale writes only to the Unchaind sandbox (`vjcdpodsrpemanfvrshh`). Never Unchaind prod (`doiafuhoourjtqsmzook`).
- Don't edit Guillaume's uncommitted `unchaind/scripts/reset-community.mjs` or `unchaind/package.json`; running `npm run community:reset` (sandbox, no args) is allowed.
- All on-screen text in English. Text = feature names, the title ("One SDK", "Community SDK") and the CTA ("Ask Claude to add a community" + `roca-features:community`). Nothing explains a feature.
- Video 16:9, 80–90 s, music, no voice. Bento 1920×1080 PNG, layout C.
- Approval gates (stop and wait for Guillaume): Task 5 (skin looks), Task 8 (rough cut), Task 10 (bento draft). Slack is drafted, never posted.
- Simulator interaction through Argent (`argent-device-interact`, `argent-screen-recording`, `argent-create-e2e`); `xcrun simctl` only for what Argent lacks (status bar override, push payload).
- New repo `~/Developer/community-sdk-showcase` stays local: no GitHub remote unless Guillaume asks.

## Review Focus

1. **Skin switch leaks the previous skin** (cached feed, old default name, old theme) — expected: after a switch, nothing from the previous skin shows. Test in Task 2.
2. **A seed run aimed at the wrong project** — expected: `seed.mjs` refuses any ref other than scratch. Test in Task 4.
3. **The "All" feed shows another skin's posts** — expected: a seed leaves only its own skin's content. Test in Task 4.
4. **Harmony's seeded translations replaced by live ones** — expected: the caption and "See original" show the seeded text during the take. Check in Task 7.
5. **Close-ups too soft once cropped** — expected: crops at 2–3× still sharp in a 1080p frame. Checked in Task 7 (record at native resolution).

---

### Task 1: Showcase repo and a working feed on scratch

**Files:**

- Create: `~/Developer/community-sdk-showcase/` (copy of `~/Developer/app-template` without `.git`, `node_modules`, `ios`; then `git init`)
- Create: `backend/` (copy of `…/scratchpad/scratch-backend/`, still linked to scratch), `docs/mockups/bento-layouts.html` (copy of the brainstorm mockup), `docs/spec.md` (copy of the spec)
- Modify: `app/_layout.tsx`, `app/index.tsx`, `components/Provider.tsx`, `metro.config.js`, `app.config.ts`, `package.json`
- Create: `lib/supabase.ts`, `.env` (`EXPO_PUBLIC_SUPABASE_URL=https://cozfrhmbjrvotpwjnqmu.supabase.co`, `EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon>`)

**Interfaces:**

- Produces: `supabase: SupabaseClient` (AsyncStorage persistence, `persistSession: true`) exported from `lib/supabase.ts`; `queryClient` from `components/Provider.tsx`.

- [ ] **Step 1:** Copy the template and the scratchpad artifacts above, `git init`, first commit "chore: start from app-template".
- [ ] **Step 2:** Strip the rig: `app/index.tsx` redirects straight to `/community`; remove the onboarding routes, `PaywallHost`, the paywall provider and the analytics/RevenueCat/Onboarding Studio init imports from the boot path (delete their files only if nothing else imports them). App name "Community SDK", bundle id `com.rocapine.communityshowcase`.
- [ ] **Step 3:** Install `@rocapine/community-core@^0.14.0 @rocapine/community-ui@0.14.1 @supabase/supabase-js`, then `npx expo install @gorhom/bottom-sheet expo-image-picker expo-image-manipulator expo-notifications` (others are already in the template). Add the React Query pin to `metro.config.js` exactly as in `community-sdk/docs/integration.md` Phase 2.
- [ ] **Step 4:** Anonymous sign-ins must be on for scratch: the app signing in anonymously must get a session. If refused, enable them with the Management API `PATCH /v1/projects/cozfrhmbjrvotpwjnqmu/config/auth` `{"external_anonymous_users_enabled": true}`.
- [ ] **Step 5:** `app/community.tsx` mounts the reference shell from `community-sdk/examples/expo-app/App.tsx` (feed, profile, inbox, one `ThreadSheet`) with a minimal config (all modules on, topics `general`). Build with `npx expo run:ios` on the iPhone 18 Pro simulator (`2DA6640D-…`, from `list-devices`); Metro on port 8083 (8081/8082 belong to other sessions).
- [ ] **Step 6: Verify** — the feed renders empty with no red box; composing a post "hello" publishes and appears (moderation passes). `npm run typecheck` passes.
- [ ] **Step 7: Commit** "feat: community SDK on scratch".

### Task 2: Skin system and runtime switch

**Files:**

- Create: `skins/types.ts`, `skins/index.ts`, `skins/<id>/index.tsx` stubs for `tdy lockyn pose eve harmony maia mylittlechef goodboy`
- Create: `lib/skinSwitch.ts`, `scripts/verify-skins.ts`
- Modify: `app/community.tsx`, `package.json` (`"verify:skins": "npx tsx scripts/verify-skins.ts"`)

**Interfaces:**

- Produces:

  ```ts
  export type SkinId =
    | "tdy"
    | "lockyn"
    | "pose"
    | "eve"
    | "harmony"
    | "maia"
    | "mylittlechef"
    | "goodboy";
  export interface Skin {
    id: SkinId;
    appName: string; // also CommunityConfig.appName
    config: Omit<CommunityConfig, "supabase">;
    theme: CommunityUIProviderProps["theme"];
    translations?: CommunityUIProviderProps["translations"];
    icons?: CommunityUIProviderProps["icons"];
    fonts?: Record<string, number>; // expo-font map, loaded before mount
    feedProps?: Partial<CommunityFeedScreenProps>; // headerLayout, render slots, bottomChrome…
    inboxProps?: Partial<NotificationInboxScreenProps>;
    statusBar: "light" | "dark";
  }
  export const SKINS: Record<SkinId, Skin>;
  export function getActiveSkinId(): SkinId; // lib/skinSwitch.ts
  export function switchSkin(id: SkinId): Promise<void>;
  ```

  (Use the SDK's exported prop types; if a name differs, use the SDK's and keep this shape.)

- [ ] **Step 1: Write `scripts/verify-skins.ts`** — imports `SKINS` and asserts: 8 skins; every skin sets `config.defaultName`, `config.modules.reaction` (with a key), `theme.colors.accent`, `feedProps.headerLayout`; the 8 `defaultName.label` values, the 8 reaction keys, the 8 accents and the 8 `headerLayout` JSON strings are each pairwise distinct; at least 4 distinct `icons` sets (by identity) across skins.
- [ ] **Step 2:** Run `npm run verify:skins` → FAIL (stubs).
- [ ] **Step 3:** Implement `switchSkin`: persist the id (AsyncStorage key `showcase.skin`), `supabase.auth.signOut()` then fresh `signInAnonymously()` (new identity ⇒ the skin's own default name), `queryClient.clear()`, then remount the provider tree with `key={skinId}`. Initial skin: launch argument `-skin <id>` read with RN `Settings.get("skin")` (iOS NSUserDefaults argument domain), else the persisted id, else `tdy`. Hidden picker: 3-finger long-press on the feed opens a list of the 8 skins (dev only, never visible in takes).
- [ ] **Step 4:** Fill the stubs with placeholder-but-distinct values so the verifier passes; real looks come in Task 3.
- [ ] **Step 5: Verify** — `npm run verify:skins` PASS; on the simulator, launch with `-skin lockyn`, switch to `pose`: the feed refetches, the composer shows a new default name, no Lockyn colors remain (Review Focus 1).
- [ ] **Step 6: Commit** "feat: runtime skins".

### Task 3: The eight skins

**Files:**

- Modify: `skins/<id>/index.tsx` ×8; Create: `skins/<id>/assets/*` (logo, fonts), `skins/<id>/slots.tsx` where a skin has render slots
- Read-only sources: `~/Developer/{oly,lockyn,eve,harmony,maia}` (pull), clone `Rocapine/pose`, `Rocapine/my-little-chef`, `Rocapine/goodboy` into `~/Developer/`

**Interfaces:**

- Consumes: `Skin` (Task 2). Produces: final `SKINS`.

Per skin, take colors, fonts, radius, logo and tone from the app's own theme/tokens files, and wire the options from the spec's skin table:

| Skin         | Must wire                                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tdy          | `headerLayout.title` = logo image; `modules.streaks` + `host.getStreak` + `renderStreakPill` (app-drawn); reaction "Respect" 💪; `beforeCompose` opens an in-app fake paywall modal in TDY style (no purchase) |
| lockyn       | `icons` from a different `@expo/vector-icons` family than every other skin's; `renderAvatar` with a rank frame; reaction "Power up" ⚡                                                                         |
| pose         | `modules.images`; radius `lg`/`pill` very round; `fonts.serifBold`/`serifBoldItalic` + serif regular                                                                                                           |
| eve          | topics `trimester-1 trimester-2 trimester-3 postpartum` + `announcements` with `officialOnly: true`; topic requests on; reaction 🤍                                                                            |
| harmony      | `modules.translation.locales` = `["en","es-419","pt-BR"]`; `translations.locale = "es-419"` (UI in Spanish)                                                                                                    |
| maia         | `modules.polls`; `renderReactionButton` (✨, app-drawn); `headerLayout.left` = `search`                                                                                                                        |
| mylittlechef | `renderPostFooter` recipe card "Add to meal plan"; `feed.extraPostColumns` + `transformPost` exposing a `recipe` field the card reads                                                                          |
| goodboy      | `modules.inbox` + `modules.push`; `renderInboxRow`; `defaultName.label` "Dog Parent"; `bottomChrome` = a GoodBoy-style tab bar                                                                                 |

Every skin also gets its own `headerLayout`, reaction, `defaultName` and an icon set (≥4 distinct families overall).

- [ ] **Step 1:** Set `COMMUNITY_TRANSLATION_LOCALES=en,es-419,pt-BR` on scratch (`supabase secrets set --project-ref cozfrhmbjrvotpwjnqmu …`).
- [ ] **Step 2:** Implement skins one at a time; after each, launch it on the simulator with a throwaway post and screenshot the feed.
- [ ] **Step 3: Verify** — `npm run verify:skins` PASS; `npm run typecheck` PASS; each of the 8 skins renders with its options visible (screenshots kept in `docs/review/skins/<id>.png`).
- [ ] **Step 4: Commit** "feat: eight skins".

### Task 4: Seed engine and per-skin content

**Files:**

- Create: `scripts/seed.mjs`, `scripts/seed-lib.mjs`, `seeds/<id>.mjs` ×8, `seeds/images/<id>/*.jpg`, `scripts/seed-lib.test.mjs`
- Modify: `package.json` (`"seed": "node scripts/seed.mjs"`, `"test:seed": "node --test scripts/seed-lib.test.mjs"`)

**Interfaces:**

- Consumes: skin topics/reaction keys from `SKINS` (duplicated as plain data in each `seeds/<id>.mjs`, not imported from TS).
- Produces: `npm run seed -- <skinId> [--dry-run]`;

  ```js
  // seed-lib.mjs
  export const SCRATCH_REF = "cozfrhmbjrvotpwjnqmu";
  export function assertScratch(ref)            // throws unless ref === SCRATCH_REF
  export function buildSeedSql(content, now)    // -> string: wipe + inserts, dates shifted to `now`
  ```

  `content` = `{ users: [{ key, name, official?, streakDays?, bestStreakDays? }], posts: [{ a, topic, t, body, image?, pinned?, poll?, recipe?, translations?: { [locale]: string }, comments, likes, reactions }], notifications? }` — the same post shape as `unchaind/scripts/reset-community.mjs` plus the new fields.

- [ ] **Step 1: Write `scripts/seed-lib.test.mjs`** (`node:test`):
  - `assertScratch("doiafuhoourjtqsmzook")` and `assertScratch("vjcdpodsrpemanfvrshh")` throw; `assertScratch(SCRATCH_REF)` doesn't.
  - `buildSeedSql(fixture, now)` starts with deletes of every community table (posts, comments, likes, post*reactions, poll*_, _\_translations, notifications, reports, blocks) and of seeded `auth.users`, so nothing from a previous skin survives (Review Focus 3).
  - a fixture user with `official: true` yields `is_official = true`; `streakDays: 30` yields `streak_started_at` 30 days before `now`; a post with `translations.es-419` yields one `post_translations` row.
- [ ] **Step 2:** `npm run test:seed` → FAIL.
- [ ] **Step 3:** Implement `seed-lib.mjs` by adapting the SQL generation of `unchaind/scripts/reset-community.mjs` (users in `auth.users` tagged `raw_user_meta_data.seed = "showcase"`, profiles, posts approved, comments, likes, reactions, polls) plus pinned/official, streak columns, translations and the `recipe` column (`extraPostColumns`, added by a `backend/supabase/migrations/*_showcase_recipe.sql` migration — scratch only). Images: upload to the `post-images` bucket with the service-role key (`supabase projects api-keys`), then reference the path.
- [ ] **Step 4:** `seed.mjs <id>` = `assertScratch` → load `seeds/<id>.mjs` → `buildSeedSql` → `supabase db query --linked -f <tmp> --workdir backend` (or print with `--dry-run`). Also deletes the viewer's anonymous profile name so the skin's default name is reassigned.
- [ ] **Step 5:** Write the 8 contents: 6–10 house accounts each, tone of the app, English except Harmony (Spanish/Portuguese originals + seeded English translations); each skin's content covers the beats it films (spec "Video" list). Photos for Pose and My Little Chef via `roca-features:generate-assets` (Nano Banana), JPEG ≤ 2 MB.
- [ ] **Step 6: Verify** — `npm run test:seed` PASS; `npm run seed -- eve` then the app on `-skin eve` shows only Eve posts, the pinned official announcement on top; `npm run seed -- maia` then Eve's posts are gone.
- [ ] **Step 7: Commit** "feat: per-skin seeds".

### Task 5: GATE 1 — skin looks

- [ ] **Step 1:** For each skin: seed, launch, screenshot the feed plus close-ups of header, a post's action row, the reaction and the default name. Put them in a review page in the visual companion (`superpowers:brainstorming` visual-companion server, project dir `~/Developer/community-sdk-showcase`), one row per skin.
- [ ] **Step 2:** Stop. Ask Guillaume to approve or comment per skin. Apply changes, re-shoot the changed skins, repeat until approved. Nothing is recorded before this.

### Task 6: Unchaind finale on the sandbox

**Files:**

- Create: `unchaind/streaks.sql` (in the showcase repo), `unchaind/README.md` (how the take is set up)

- [ ] **Step 1:** In `~/Developer/unchaind`: `npm run community:reset` (sandbox; no `prod`).
- [ ] **Step 2:** Write `streaks.sql`: sets `streak_started_at` / `best_streak_days` on the 8 house accounts (tag `community-2026-10`) spread over bronze, silver and gold — tier thresholds from `community-sdk/packages/ui` streak pill code. Apply: `supabase db query --project-ref vjcdpodsrpemanfvrshh -f unchaind/streaks.sql` after checking the ref in the command is the sandbox.
- [ ] **Step 3:** Run the Unchaind dev client on the same simulator against the sandbox (recipe: memory `unchaind-community-sdk-migration`, Metro 8082 from a worktree with `.env.local` copied), open the community.
- [ ] **Step 4: Verify** — the feed shows the house posts with bronze/silver/gold pills; Live Prayer opens from a post.

### Task 7: Shot list and recording

**Files:**

- Create: `video/shotlist.md`, `flows/<skin>-<beat>.yaml` (Argent e2e), `footage/<skin>/<beat>.mp4` (git-ignored, kept on disk)

- [ ] **Step 1:** `video/shotlist.md`: one row per video beat (spec list, in order) → skins in it → the action filmed (scroll, tap reaction, open poll, tap "See original"…) → the crop region to use in the edit.
- [ ] **Step 2:** Before recording: `xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3`; device iPhone 18 Pro, native resolution.
- [ ] **Step 3:** Per skin: `npm run seed -- <id>`, launch with `-skin <id>`, record each beat as an Argent flow (`argent-create-e2e`) so retakes replay identically, capture with `argent-screen-recording`. Harmony: record right after seeding (Review Focus 4). GoodBoy push: `xcrun simctl push` with a "Dog Parent liked your post" payload while the app is in background; the banner shows the demo app's name/icon, so either crop it to its text in the edit or switch the app's display name and icon to GoodBoy's for that take (spec, "Calls made by Claude").
- [ ] **Step 4:** Unchaind takes (Task 6 setup): feed with pills, Live Prayer.
- [ ] **Step 5: Verify** — every shotlist row has a take; spot-check 3 takes cropped at 3× in ffmpeg still read sharp at 1080p (Review Focus 5).

### Task 8: GATE 2 — rough cut

**Files:** Create: `video/` HyperFrames project (`hyperframes:product-launch-video`, `motion-graphics`)

- [ ] **Step 1:** Assemble the beats in order with crops/zooms from the shot list, placeholder titles (feature names in English), temp music, 16:9 1920×1080, target 80–90 s.
- [ ] **Step 2:** Export `deliverables/rough-cut.mp4`, send it to Guillaume (`SendUserFile`). Stop until approved; iterate.

### Task 9: Final video

- [ ] **Step 1:** Final titles, transitions, licence-safe music (`hyperframes:hyperframes-audio`), CTA end card "Ask Claude to add a community" + `roca-features:community`.
- [ ] **Step 2:** Export `deliverables/community-sdk.mp4`, then `ffmpeg -i community-sdk.mp4 -vcodec libx264 -crf 28 -vf scale=1920:-2 -c:a aac -b:a 128k community-sdk-slack.mp4`.
- [ ] **Step 3: Verify** — duration 80–90 s, 1920×1080, audio present, every on-screen word English and a feature name/title/CTA only; send to Guillaume.

### Task 10: GATE 3 — bento

**Files:** Create: `bento/index.html`, `bento/crops/*.png`, `deliverables/community-sdk-bento.png`

- [ ] **Step 1:** Layout C from `docs/mockups/bento-layouts.html`: title band + ~8–10 feature tiles, each tile laid out for its feature, multi-skin where the feature is about variety; crops taken from the takes (full-res frames, not the compressed video).
- [ ] **Step 2:** Show the draft (visual companion or `SendUserFile`). Stop until Guillaume approves the tile list; iterate.
- [ ] **Step 3:** Export 1920×1080 PNG (headless Chrome screenshot at device scale 1 of a 1920×1080 viewport). Verify size with `sips -g pixelWidth -g pixelHeight`.

### Task 11: Slack draft

- [ ] **Step 1:** Ask Guillaume which channel and which language. Write a short message (what the SDK is, that it's ready, "ask Claude to add a community" / `roca-features:community`), attach video + bento, and save it as a draft with `slack_send_message_draft` (load `slack:slack-messaging` first). Never send.
- [ ] **Step 2:** Tell Guillaume where the draft is and which files to attach if the draft can't carry them.
