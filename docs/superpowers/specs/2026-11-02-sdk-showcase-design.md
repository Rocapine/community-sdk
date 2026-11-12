# Community SDK showcase — video + bento grid for Slack

Date: 2026-11-02 · Owner: Guillaume · SDK version: `@rocapine/community-ui` 0.14.1 / `community-core` / CLI 0.14.0

## Intent

Tell the whole company the Community SDK is ready and show what it can do, so anyone
building a Rocapine app knows they can drop a community into it. Everyone at Rocapine
vibecodes mobile apps (devs, PMs, designers and more), so the pieces must work **without
any explanation**: a viewer understands each feature by seeing it.

The message to land is **modularity and customisation**: one SDK that looks native in
very different apps. Real Rocapine apps are only the examples that prove it — this is not
a tour of the apps.

Deliverables, all posted together on Slack by Guillaume:

1. A **video**, 16:9, about 80–90 s.
2. A **bento grid** image, 16:9, 1920×1080 PNG.
3. A **Slack message** draft that carries both.

No deadline.

## Goals

- Every SDK option worth showing appears in the video, most of them in the bento.
- Features whose point is variety (header, icons, reactions, anonymous names, themes)
  are shown on **several apps side by side or in quick succession**, so the difference
  is the message.
- Ends on a call to action: ask Claude to add a community — the `roca-features:community`
  skill — not `npm install`.

## Non-goals

- The demo app is a recording rig, not a product: no store build, no EAS, no tests beyond
  what keeps it running, not pushed anywhere unless Guillaume asks.
- No voice-over, no subtitles explaining features.
- No changes to the SDK itself. If a skin needs something the SDK can't do, drop or swap
  that option rather than patching the SDK.

## Anti-goals (would make it a failure even if it "works")

- An app-by-app walkthrough ("here is TDY… here is Lockyn…").
- Any text that explains a feature. On-screen text is limited to **feature names**, the
  title and the call to action — **all in English**.
- Whole-phone shots all along. Most shots are **close-ups on a part of the UI** (a header,
  a row of icons, a reaction button, a name chip).
- Slow pacing. The edit is dynamic.
- Any write to Unchaind production (`doiafuhoourjtqsmzook`).

## The apps (skins)

One demo app, eight skins, each reproducing a real Rocapine app's look (colors, fonts,
radius, logo, tone of the seeded content) taken from that app's own repo/design tokens.
Unchaind is the finale, filmed in the real Unchaind app.

| Skin                                                                       | Look (to confirm from its repo) | Options it carries                                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TDY** (OLY, `~/Developer/oly`)                                           | dark, energetic sports coach    | logo image as header title; streaks with an app-drawn pill (`renderStreakPill`); reaction `💪 Respect`; paywall before posting (`beforeCompose`)  |
| **Lockyn** (`~/Developer/lockyn`)                                          | manga/manhwa, neon, young male  | another icon library; rank-framed avatars (`renderAvatar`); reaction `⚡ Power up`                                                                |
| **Pose** (clone `Rocapine/pose`)                                           | clean girl, cream, serif        | images in posts and comments + full-screen viewer; very round radius; serif fonts                                                                 |
| **Eve** (Motherhood Wellness, prenatal/postpartum yoga, `~/Developer/eve`) | soft, maternity                 | topics (trimesters, postpartum); an `officialOnly` topic with pinned official announcements; topic requests                                       |
| **Harmony** (`~/Developer/harmony`)                                        | cycle syncing, women's health   | automatic translation with the "Translated from … · See original" caption; UI in another language                                                 |
| **Maia** (`~/Developer/maia`)                                              | astrology, starry night         | polls; app-drawn reaction button (`renderReactionButton`, ✨); search on the left of the header                                                   |
| **My Little Chef** (clone `Rocapine/my-little-chef`)                       | family meals, mascot            | a recipe card under posts via `renderPostFooter` ("Add to meal plan"); extra post data (`feed.extraPostColumns` / `transformPost`)                |
| **GoodBoy** (clone `Rocapine/goodboy`)                                     | dog training, playful           | notification inbox with custom rows (`renderInboxRow`); push; anonymous default name ("Dog Parent"); host tab bar under the feed (`bottomChrome`) |
| **Unchaind** (finale)                                                      | the real app                    | the full community: Live Prayer, bronze/silver/gold streak pills                                                                                  |

On top of each skin's own options, the "variety" features run across **many skins**:
custom header layout on almost every skin, an icon set per style (at least 4 distinct
libraries/styles), a custom reaction per skin, a default anonymous name per skin, and a
theme per skin. AI moderation (a post blocked before publishing) and polls/photos can
appear on whichever skin films best.

## Video

Built **by feature, not by app**. Each beat: the feature name in English, then fast cuts
of close-ups from several skins. No explanation text, no voice. Music only.

1. **Opening** — the 8 feeds side by side, zoom into one. Title "One SDK".
2. **Themes** — hard cuts between the 8 full feeds.
3. **Custom header** — close-ups of the header on almost every skin.
4. **Icon sets** — close-ups of a post's action row, 4+ icon styles.
5. **Custom reactions** — a tap on each skin's reaction (💪 ⚡ ✨ 🤍 🐾 …).
6. **Anonymous names** — close-ups on each skin's default name.
7. Short beats, one or two skins each: **Polls**, **Photos**, **Translation** (tap "See
   original"), **Official & pinned**, **Streaks**, **Custom slots** (recipe card),
   **Notifications** (push banner, then the inbox), **Paywall gate**, **AI moderation**.
8. **Finale** — Unchaind: Live Prayer and the bronze/silver/gold streak pills.
9. **Call to action** — "Ask Claude to add a community" + `roca-features:community`.

Format 16:9, ~80–90 s. Compress before sharing:
`ffmpeg -i in.mp4 -vcodec libx264 -crf 28 -vf scale=-2:1280 -an out.mp4` — but keep the
music (drop `-an`); the `scale` targets vertical video, so pick a 16:9-appropriate size.

## Bento grid

Layout **C** (picked in the visual companion): a slim title band ("Community SDK" + the
call to action), then fewer, larger tiles. **Each tile is one feature, with a layout made
for that feature**, mixing skins wherever the feature is about variety (all reactions in
one tile, all headers stacked in one tile, etc.). Tiles are made from real crops of the
recorded skins, not invented UI. All text in English. Exact tile list is the builder's
call, guided by the video beats; reference mockup:
`scratchpad/sdk-showcase/.superpowers/brainstorm/*/content/bento-layouts.html` (option C).

## Backend and content

- **Demo skins → `community-sdk-scratch` (`cozfrhmbjrvotpwjnqmu`)**, the dev/debug
  project. Guillaume allows anything there. Already reset and migrated to the 0.14 backend
  on 2026-11-02 (all 8 modules, 26 migrations, project settings seeded, 10 Edge Functions
  deployed; `OPENAI_API_KEY` present). Working copy of the backend files:
  `scratchpad/scratch-backend/` (linked with the Supabase CLI; `supabase db query --linked -f`
  works, the DB password is not needed).
- The "All" feed shows every post in the backend regardless of configured topics
  (`packages/core/src/service.ts`), so **each skin gets its own seed script that wipes the
  community content and seeds that skin's content** right before it is filmed: 6–10 house
  accounts in the skin's tone, posts, comments, likes/reactions, photos, a poll, official
  posts, streak values, notifications — whatever its beats need. Dates relative to the run,
  like Unchaind's script.
- Translation module: `COMMUNITY_TRANSLATION_LOCALES` must be set on scratch and match the
  Harmony skin's `modules.translation.locales`. Harmony's translations are **pre-filled by
  the seed** (not generated live) so takes are reproducible.
- **Unchaind finale → Unchaind sandbox (`vjcdpodsrpemanfvrshh`)**, seeded with Guillaume's
  `unchaind/scripts/reset-community.mjs` content (`npm run community:reset`, sandbox is the
  default), **plus streaks** for the house accounts (`profiles.streak_started_at`,
  `best_streak_days`) spread across bronze/silver/gold. That script and the `package.json`
  change are Guillaume's **uncommitted** work in the main Unchaind checkout: don't edit
  them in place; add the streaks in a separate step (a copy or a small follow-up script).
  Never run it with `prod`.

## Approval gates (Guillaume's call)

Work stops and waits for Guillaume's OK at three points:

1. **Skin looks — before seeding and recording.** Show the 8 skins (screenshots of each
   feed, plus its header/reaction/name close-ups) side by side; nothing is seeded for real
   or recorded until he approves. Most important gate: a skin changed after recording
   means reshooting all its takes.
2. **Rough cut of the video — before HyperFrames polish.** Beats, order, timing and the
   close-ups, with placeholder titles/music is fine.
3. **Bento tile list — before the final export.** A draft of the grid with the real crops.

The Slack draft is a fourth stop by nature: Guillaume posts it himself.

## How it gets made (decided)

- Demo app scaffolded from `~/Developer/app-template` (Expo SDK 55), in a new local folder
  `~/Developer/community-sdk-showcase`, with `@rocapine/community-core` and
  `@rocapine/community-ui` at 0.14.1. One app, skins switchable at runtime (e.g. a hidden
  picker or a launch argument) so recording doesn't need rebuilds. Follow the SDK's
  `docs/integration.md` (pin `@tanstack/react-query` in `metro.config.js`) and
  `examples/expo-app/App.tsx` for wiring.
- Recording: Argent on the iOS simulator (`argent-screen-recording`), status bar
  overridden, full-screen takes; close-ups are crops/zooms done in the edit.
- Video: HyperFrames (`hyperframes:product-launch-video` / `motion-graphics` skills),
  licence-safe music.
- Bento: built as an HTML/React composition of the real crops (stageshow approach was
  suggested by Guillaume; any tool that gives a crisp 1920×1080 PNG is fine), exported to PNG.
- Slack: a draft via the Slack connector; Guillaume reviews and posts it himself. Channel
  to ask when the draft is ready.

## Repos

Local: `oly`, `lockyn`, `eve`, `harmony`, `maia`, `unchaind`, `community-sdk`,
`app-template` (pull first). To clone into `~/Developer/`: `Rocapine/pose`,
`Rocapine/my-little-chef`,
`Rocapine/goodboy`. GoodBoy and My Little Chef are archived in the Publishing Platform;
Maia isn't listed there — irrelevant for the demo.

## Left to the builder

- Exact theme tokens, fonts, logos and copy per skin (from each repo).
- Which icon libraries for which skin (4+ visibly different styles).
- Default anonymous names, reaction labels, topic lists per skin.
- Seed content per skin (English; Harmony seeds Spanish/Portuguese posts for translation).
- The exact cut, timing, transitions and music of the video; the bento tile list.
- How the push banner is produced on the simulator.

## Calls made by Claude (check these)

- **Durable copies first:** the bento mockup and the `scratch-backend/` working copy live
  in a session scratchpad that gets cleaned; copy them into
  `~/Developer/community-sdk-showcase/` as the first step.
- **Anonymous names per skin:** the SDK assigns a default name once per identity, only
  when the profile has none. Each skin's seed resets the viewer's profile (or signs in a
  fresh anonymous identity) so every skin shows its own default name.
- **Harmony translations stay seeded:** live translation (`translate-one`,
  `daily-translation`) could overwrite the seeded rows; the Harmony seed runs after any
  sweep and the skin's takes are filmed right after seeding (or translation webhooks are
  paused on scratch for that take).
- **Push banner:** it shows the demo app's name and icon, not GoodBoy's. Either the
  banner is cropped to its text in the edit, or the demo app's display name/icon is
  switched to GoodBoy's for that take.
