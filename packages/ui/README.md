# @rocapine/community-ui

Themable, ready-to-mount React Native screens and components for the
Community SDK: feed, thread, profile, profile edit, notification inbox,
composer, poll block, rules/report sheets. Navigation is by callback props
(`onOpenProfile(userId)`, `onOpenThread(postId)`, ...) — this package has no
dependency on `expo-router` or `react-navigation`; you mount its screens
inside your own router.

```bash
npm install @rocapine/community-ui
```

Peer dependencies (beyond `@rocapine/community-core`'s own):
`react-native >=0.74.0`, `react-native-reanimated >=3.16.0`,
`expo-image >=1.10.0`, `expo-haptics >=13.0.0`,
`expo-image-picker >=15.0.0`, `phosphor-react-native >=2.0.0`. Icons are not
injectable in v1 — `phosphor-react-native` is a hard dependency.

## Provider

```tsx
import { CommunityUIProvider } from "@rocapine/community-ui";

<CommunityUIProvider
  theme={{ colors: { accent: "#6C4DF6" } }}
  translations={{ locale: "es-ES", overrides: { "rules.accept": "Estoy de acuerdo" } }}
>
  {/* your screens */}
</CommunityUIProvider>;
```

`CommunityUIProvider` must sit inside `@rocapine/community-core`'s
`CommunityProvider` (see the root README's quickstart). `theme` and
`translations` are both optional — omit either to get the neutral defaults.

## Theming

`theme` is a `DeepPartial<CommunityTheme>`, merged over `defaultTheme` via
`mergeTheme` (exported, in case you want to build a theme object outside the
provider). `useCommunityTheme()` reads the resolved theme in your own
components; `useThemedStyles(factory)` memoizes a `StyleSheet.create(...)`
against theme identity (avoids rebuilding style objects on every render).

`CommunityTheme` shape:

```ts
type CommunityTheme = {
  colors: {
    background: string;
    surface: string;
    surfaceMuted: string;
    border: string;
    borderStrong: string;
    hairline: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textFaint: string;
    textInverse: string;
    accent: string;
    accentSoft: string;
    danger: string;
    success: string;
    like: string;
    official: string;
    pinned: string;
  };
  fonts: {
    regular: string | undefined;
    medium: string | undefined;
    bold: string | undefined;
    serifBold: string | undefined;
    serifBoldItalic: string | undefined;
  };
  radius: { sm: number; md: number; lg: number; pill: number };
  spacing: (n: number) => number; // default: n * 4
  shadow: {
    shadowColor: string;
    shadowOpacity: number;
    shadowRadius: number;
    shadowOffset: { width: number; height: number };
    elevation: number;
  };
};
```

The default theme is a neutral placeholder palette (`accent: "#4C6FFF"`,
system fonts) — no app branding. `like`/`official`/`pinned` default to
`accent` too but are separate tokens so you can diverge them.

## i18n

Framework-free, no i18next. 7 built-in locales ship as plain objects:
`en`, `es-ES`, `es-419`, `it`, `pl`, `pt-PT`, `pt-BR` (all exported by name,
e.g. `import { en, esES, es419, it, pl, ptPT, ptBR } from "@rocapine/community-ui"`).

```tsx
<CommunityUIProvider translations={{ locale: "pt-BR", overrides: { "rules.accept": "..." } }}>
```

Lookup order for a key: `overrides` → `catalog[locale]` (exact match) →
`catalog[baseLocale]` (base-language match — a locale not shipped verbatim
falls back to its language family's designated base: `es`/any other `es-*`
region falls back to `es-ES`, `pt`/any other `pt-*` region falls back to
`pt-PT`, and any other language's regional variant, e.g. `it-CH`, falls back
to its bare-language catalog, e.g. `it`) → `catalog.en` → the key itself
(never a blank string). A numeric `params.count` selects `<key>.one` /
`<key>.other` (through the same fallback chain) before falling back to the
bare key — e.g. `t("feed.newPosts", { count: 3 })`.
Interpolation uses `{name}`-style placeholders, not i18next's `{{name}}`.

**Topic labels**: a topic's display label resolves through the key
`topics.<id>` — the `id` you gave it in `CommunityConfig.topics`. Built-in
ids (`news`, `general`, `question`, ...) already have translations in every
shipped locale; any topic id you invent needs its own `topics.<yourId>`
override in every locale you support, since it won't exist in the built-in
catalogs.

**The `COMMUNITY_REACTION_PUSH_TEXT` caveat**: the reaction module's push
copy (server-side, in the `notify-reaction` Edge Function) is built-in and
localized per recipient for the common "one reactor" case across all 7
locales. The `COMMUNITY_REACTION_PUSH_TEXT` secret (see
`docs/backend-runbook.md`) overrides that template — but it is a **single
string, not a per-locale map**: setting it replaces the built-in copy for
every recipient locale at once with the one string you set (with `{name}`
substituted). If you set this secret, pick wording that reads acceptably in
translation, or don't set it and rely on the neutral built-in copy. The
"and N others" multi-reactor phrasing always comes from the built-in
per-locale table regardless — there is no secret for it.

## Slots

Render-prop customization points that receive the SDK's own default node so
you can wrap, replace, or ignore it:

- `CommunityPost`'s `renderPostFooter?: (post: FeedPost, defaults: ReactNode) => ReactNode`
  and `renderReactionButton?: (post: FeedPost, defaultButton: ReactNode) => ReactNode`
  — passed through from `CommunityFeedScreen`'s own `slots` prop
  (`PostSlots`). `renderReactionButton` is how you swap the generic reaction
  button for something app-specific (e.g. a themed prayer/support sheet)
  while keeping everything else about the post card unchanged.
- `NotificationInboxScreen`'s `renderInboxRow?: (item: InboxItem, defaults: ReactNode | null) => ReactNode`
  — called for every row; `defaults` is a built-in row for a recognized kind
  (`like`/`comment`/`reaction`/`official_post`) or `null` for an
  app-defined custom kind the SDK doesn't know how to render itself (e.g. a
  `support_reply` notification your own backend inserts).

## Screens

| Screen                    | Key props                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CommunityFeedScreen`     | `onOpenProfile(userId)`, `onOpenInbox?()`, `header?: ReactNode`, `slots?: PostSlots`                                           |
| `ThreadSheet`             | `postId: string \| null`, `onClose()`, `onOpenProfile(userId)` — self-contained sheet, render it once and drive it by `postId` |
| `ProfileScreen`           | `userId: string`, `onOpenThread(postId)`, `onBack?()`                                                                          |
| `ProfileEditSheet`        | `visible: boolean`, `onClose()`                                                                                                |
| `NotificationInboxScreen` | `onOpenPost(postId)`, `renderInboxRow?` (see Slots above)                                                                      |

Plus standalone components you can use directly: `CommunityPost`,
`PollBlock`, `NoticeCard`, `ComposerCard`, `RulesSheet`, `ReportSheet`, and
the package's own `CommunitySheet` primitive (no host sheet library needed).

See `examples/expo-app/App.tsx` for a complete, working wiring of
`CommunityFeedScreen` + `ProfileScreen` + `NotificationInboxScreen` +
`ThreadSheet` behind a simple `useState`-driven router.
