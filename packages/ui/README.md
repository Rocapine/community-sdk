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
`@gorhom/bottom-sheet >=5.1.0`, `react-native-gesture-handler >=2.16.1`,
`react-native-safe-area-context >=4.10.0`, `expo-image >=1.10.0`, `expo-haptics >=13.0.0`,
`expo-image-picker >=16.0.0`, `expo-symbols >=0.4.0`, `expo-image-manipulator >=13.0.0`.
`expo-image-manipulator` is optional too: with it, avatars are resized to
512px JPEG before upload (`resizeAvatar`, also exported for your own
picker); without it they upload as picked. **With the images module
(`modules.images`) it is required** (see Images below).
`expo-symbols` is an **optional** peer (`peerDependenciesMeta`) —
skip it if you pass a complete `icons` set to `CommunityUIProvider` (see
Icons below); the default icon set only requires it once a default icon
actually renders.

The sheets (thread, report, rules, profile edit) are built on
`@gorhom/bottom-sheet` for swipe-to-close and keyboard handling; it is pure JS
on top of gesture-handler and reanimated, and each sheet brings its own
`GestureHandlerRootView`/`SafeAreaProvider`, so no provider is needed in your
app.

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
    reaction: string; // active reaction icon + count
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
  // Paired with each family; default 400 / 500 / 600. Lets a host that loads one
  // family with several weights (expo-font `fontDefinitions`) get real bold text.
  fontWeights: { regular: FontWeight; medium: FontWeight; bold: FontWeight };
  // The only four radii used. Nested surfaces are concentric: a `lg` card with
  // `spacing(4)` padding holds `sm` children.
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
system fonts) — no app branding. `like`/`reaction`/`official`/`pinned` default to
`accent` too but are separate tokens so you can diverge them.

Icons receive `weight: "fill"` in their active state (liked, reacted), so a
custom icon can swap glyphs there instead of filling the outline one.

## i18n

Framework-free, no i18next. 13 built-in locales ship as plain objects:
`en`, `es-ES`, `es-419`, `fr`, `fr-vous`, `de`, `it`, `pl`, `pt-PT`, `pt-BR`,
`ko`, `ro`, `uk` (all exported by name, e.g.
`import { en, esES, es419, fr, frVous, de, it, pl, ptPT, ptBR, ko, ro, uk } from "@rocapine/community-ui"`).

```tsx
<CommunityUIProvider translations={{ locale: "pt-BR", overrides: { "rules.accept": "..." } }}>
```

Lookup order for a key: `overrides` → `catalog[locale]` (exact match) →
`catalog[baseLocale]` (base-language match — a locale not shipped verbatim
falls back to its language family's designated base: `es`/any other `es-*`
region falls back to `es-ES`, `pt`/any other `pt-*` region falls back to
`pt-PT`, and any other language's regional variant, e.g. `it-CH`, falls back
to its bare-language catalog, e.g. `it`) → `catalog.en` → the key itself
(never a blank string). A numeric `params.count` selects `<key>.<category>`
for the locale's CLDR plural category (`pluralCategory`, exported — `one`/`other`,
plus `few`/`many` for Polish, falling back to `.other` when a catalog only ships
the binary pair), i.e. `<key>.one` /
`<key>.other` (through the same fallback chain) before falling back to the
bare key — e.g. `t("feed.newPosts", { count: 3 })`.
Interpolation uses `{name}`-style placeholders, not i18next's `{{name}}`.

**Topic labels**: a topic's display label resolves through the key
`topics.<id>` — the `id` you gave it in `CommunityConfig.topics`. Built-in
ids (`news`, `general`, `question`, ...) already have translations in every
shipped locale; any topic id you invent needs its own `topics.<yourId>`
override in every locale you support, since it won't exist in the built-in
catalogs.

**Translation keys**: `translation.translatedFrom` / `translation.original` /
`translation.showOriginal` / `translation.showTranslation` (the per-item
caption line, see Translations below) and `language.en` / `.es` / `.pt` /
`.it` / `.pl` / `.fr` / `.de` / `.ko` / `.ro` / `.uk` (language names used to fill in
`translation.translatedFrom`) ship in all 13 built-in locales.

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

## Icons

Not every app uses [expo-symbols](https://docs.expo.dev/versions/latest/sdk/symbols/),
so the icon set is injectable — `expo-symbols` is an optional peer
(see above), not a hard dependency. Every icon this package renders is
looked up by a semantic role name (`CommunityIconName`: `like`, `comment`,
`reaction`, `menu`, `back`, `close`, `send`, `bell`, `search`,
`officialSeal`, `pin`, `announcement`, `checkmark`, `poll`, `add`,
`warning`, `compose`, `image`), never by a glyph name. `image` (the composer's
"add an image" button) is new with the images module: a host that types a
**complete** `CommunityIconSet` must add it; at runtime a role you didn't pass
falls back to the default, so nothing breaks for a partial set.

```tsx
import { CommunityUIProvider, type CommunityIconSet } from "@rocapine/community-ui";
import { Feather } from "@expo/vector-icons";

// Bring your own icon library — map each role to a component that accepts
// { size?, color?, weight?: "regular" | "fill" | "bold" }.
const icons: Partial<CommunityIconSet> = {
  like: ({ size, color }) => <Feather name="heart" size={size} color={color} />,
  comment: ({ size, color }) => <Feather name="message-circle" size={size} color={color} />,
  menu: ({ size, color }) => <Feather name="more-horizontal" size={size} color={color} />,
  // ...the rest fall back to the built-in expo-symbols-backed (SF Symbols on iOS, Material Symbols on Android) defaults
};

<CommunityUIProvider icons={icons}>{/* your screens */}</CommunityUIProvider>;
```

Unset names fall back to `defaultIcons` (exported, expo-symbols-backed (SF Symbols on iOS, Material Symbols on Android)). Supply
every `CommunityIconName` and you never need `expo-symbols`
installed at all — the default set only `require`s it lazily, inside a
default icon's own render, so it throws a clear error (naming the fix:
install expo-symbols, or pass a complete `icons` set to
`CommunityUIProvider`) only if a default icon actually renders without it.
Read the merged set yourself with `useCommunityIcons()` (e.g. to build your
own slot content) — it returns the full `CommunityIconSet` (defaults merged
with your `icons` override), not just what you passed.

## Slots

Render-prop customization points that receive the SDK's own default node so
you can wrap, replace, or ignore it:

- `CommunityPost`'s `renderPostFooter?: (post: FeedPost, defaults: ReactNode, ctx) => ReactNode`
  and `renderReactionButton?: (post: FeedPost, defaultButton: ReactNode, ctx) => ReactNode`
  — passed through from `CommunityFeedScreen`'s own `slots` prop
  (`PostSlots`). `renderReactionButton` is how you swap the generic reaction
  button for something app-specific (e.g. a themed prayer/support sheet)
  while keeping everything else about the post card unchanged.
  If your slot opens its own native `Modal`, open it through
  `ctx.presentModal(() => setOpen(true))`: inside `ThreadSheet` (itself a
  Modal) it closes the thread first and opens yours once it's gone — iOS
  can't stack two Modals and would leave an invisible layer that blocks every
  touch. Elsewhere it just runs your callback.
- `isOptimistic(post)` (core): true while a just-sent post/comment still has
  its temporary id. Server actions keyed on the id (reactions, likes, votes)
  must wait; the author fields are already yours.
- `NotificationInboxScreen`'s `renderInboxRow?: (item: InboxItem, defaults: ReactNode | null) => ReactNode`
  — called for every row; `defaults` is a built-in row for a recognized kind
  (`like`/`comment`/`reaction`/`official_post`) or `null` for an
  app-defined custom kind the SDK doesn't know how to render itself (e.g. a
  `support_reply` notification your own backend inserts).

## Screens

| Screen                    | Key props                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CommunityFeedScreen`     | `onOpenProfile(userId, source?)`, `onOpenInbox?()`, `isFocused?: boolean` (pass your navigator's focus so new-post polling stops on other tabs), `header?: ReactNode`, `headerLayout?: FeedHeaderLayout` (see Feed header), `slots?: PostSlots`, `beforeCompose?`, `beforeSubmitComment?` (see Gating submissions), `topicRequest?` (see Topics), `postRequest?` (see Pushes), `bottomChrome?` (see Feed, composer and topics) |
| `ThreadSheet`             | `postId: string \| null`, `focusComment?: boolean` (open with the reply field focused), `onClose()`, `onOpenProfile(userId, source?)`, `onPressTopic?(topicId)` (see Topics), `slots?: PostSlots`, `beforeSubmitComment?` — self-contained sheet, render it once and drive it by `postId`; gates the first comment behind `RulesSheet` like the composer does                                                                  |
| `ProfileScreen`           | `userId: string`, `source?: "post" \| "comment"` (hand back the `source` from `onOpenProfile`, for the `profileOpened` event), `onOpenThread(postId, focusComment?)`, `onBack?()`, `topInset?: number` (feed `useSafeAreaInsets().top` when mounting it as a full-screen route), `onPressTopic?(topicId)` (see Topics), `slots?: PostSlots`                                                                                    |
| `ProfileEditSheet`        | `visible: boolean`, `onClose()`                                                                                                                                                                                                                                                                                                                                                                                                |
| `NotificationInboxScreen` | `onOpenPost(postId)`, `onOpenCommunity?()` (row with no post attached), `renderInboxRow?(item, defaults, { unread })` (see Slots above); an announcement with no author reads `inbox.newsFromTeam` — override it with your app's name                                                                                                                                                                                          |

Plus standalone components you can use directly: `PressableScale` (the
package's press feedback for buttons with a visible surface — a 0.98 scale-down,
no opacity change, optional `haptic`; icon buttons and links stay plain `Pressable`s), `CommunityPost`,
`PollBlock` (takes `showOriginal?: boolean` to render each option's
original `label` instead of its `translatedLabel`, mirroring the post/thread
toggle below), `NoticeCard`, `ComposerSheet` (the full-screen composer the feed's `+` opens; mount it yourself to compose from elsewhere), `Avatar`, `RulesSheet`, `ReportSheet`, and
the package's own `CommunitySheet` primitive (built on `@gorhom/bottom-sheet`, installed as a peer; no provider to mount).

See `examples/expo-app/App.tsx` for a complete, working wiring of
`CommunityFeedScreen` + `ProfileScreen` + `NotificationInboxScreen` +
`ThreadSheet` behind a simple `useState`-driven router.

## Feed header

`CommunityFeedScreen`'s header row is set by `headerLayout`: which buttons sit
left and right, and whether the "Community" title (`title` key) shows on the
left or in the center, or an image in its place (`title: { image, position?,
accessibilityLabel? }`, e.g. your logo; pass the source that matches your
theme). Buttons: `profile` (the user's avatar, opens their own
profile through `onOpenProfile(myUid)`), `search`, `inbox` (shown only with
`modules.inbox` on and `onOpenInbox` given). The default,
`DEFAULT_FEED_HEADER_LAYOUT`, is profile left, title centered, search and
inbox right. A layout replaces the default as a whole: a side or title left
out is empty.

```tsx
<CommunityFeedScreen
  headerLayout={{ left: ["inbox"], right: ["search", "profile"], title: false }}
  …
/>
```

## Feed, composer and topics

The feed is flat: full-width post rows separated by hairlines, the avatar in a
first column and `name › topic · time` on one line, the `…` menu at its end.
Topics are scrollable tabs. A body longer than six lines is cut with "View
more" at the end of its last line (tapping expands it for good). Times count
seconds, then minutes, hours, days, months and years.

A round `+` button (bottom right, `feed.compose` label) opens `ComposerSheet`,
a full-screen page sheet: Cancel / Post on top, the topic pill under the
user's name, a toolbar on the keyboard with the photo and poll buttons and a
character ring. Before it opens, the `+` asks for the community rules (first
time) and then awaits your `beforeCompose` (see Gating submissions). Posting
closes the sheet and publishes optimistically; a failed publish puts the draft
back for the next `+`, and Cancel on a draft asks to discard it.

**Topics.** Tapping a post's topic in the feed, its search results or its
thread selects that tab. Elsewhere it calls your `onPressTopic(topicId)`
(`ProfileScreen`, `ThreadSheet`); route back to the feed and pass
`topicRequest={{ topicId, requestedAt: Date.now() }}` — the feed applies it
each time `requestedAt` changes. Without `onPressTopic`, topics there are not
tappable.

**Comments.** A comment can be liked and replied to. Replies show one level
deep under their root comment; replying to a reply answers its author
("Replying to @handle" above the field). A reply notifies only the author of
the comment it answers.

**Host tab bar.** The feed's top bar hides as the reader scrolls down and
comes back on the way up. A host whose tab bar floats over the feed can hide it
in step: pass `bottomChrome={{ height, hidden }}`, where `height` is what the
bar covers (bottom safe area included) and `hidden` a Reanimated shared value
the feed writes from 0 (shown) to 1 (hidden); slide your bar by it. The list
clears the bar and the `+` button rides on it.

**Pushes.** Every community push carries `{ route: "/community", kind, postId }`.
To open the post from a tapped push, route to the feed and pass
`postRequest={{ postId, requestedAt: Date.now() }}` (applied each time
`requestedAt` changes), then call `useMarkPostNotificationsRead()(postId, kind)`
from core so the matching inbox items count as read.

**Avatars.** Every avatar the SDK draws (rows, comments, header button,
profiles, composer, edit preview) goes through `Avatar`. Pass
`renderAvatar={({ userId, name, url, size }) => …}` to `CommunityUIProvider`
to draw your own (e.g. a gradient per member); the default is the photo, else
the initial on a flat colour.

## Images

With `modules.images: true` (core) and the backend `images` module installed:

- **Composer.** A photo button sits in the keyboard toolbar, disabled while a
  poll is open (a post carries a poll _or_ an image). The chosen photo shows
  under the text with a ✕; tapping the button again replaces it. Publish is
  enabled with text **or** an image.
- **Feed.** The image sits in the post's text column with `radius.md` corners,
  aspect ratio kept, height capped at 4:5 (taller is center-cropped) and wide
  images floored at 1.91:1; the frame has its final size before the pixels
  load, so nothing jumps. Tapping opens the full-screen viewer (pinch / double
  tap to zoom, swipe down to close).
- **Thread.** A comment's image is at most 60% of the comment column, same caps.
  In the reply bar, while the field is focused (or an image is attached), the
  avatar on the left becomes the add-image button; the photo shows as a small
  thumbnail above the bar. Inside the thread the viewer is an overlay within
  the sheet's own Modal — never a second Modal on top (iOS freezes).
- **Requirement.** `expo-image-manipulator` (native module ⇒ new build). It
  re-encodes every photo to JPEG 0.8, long edge ≤ 1600 px, which also strips
  EXIF/GPS; the original is never uploaded. Without it the image buttons are
  hidden and a dev build warns once.
- **Gating.** `beforeSubmitComment` drafts carry the attached
  `image?: LocalImage` (see Gating submissions).
- **Exports.** `ImageViewerHost` provides the full-screen viewer;
  `CommunityFeedScreen` and `ProfileScreen` already wrap themselves in it. A
  host that renders `CommunityPost` in its own screen wraps that screen in
  `ImageViewerHost` to get the viewer. A host that renders `CommunityPost`
  inside its own `CommunitySheet` must **not** wrap it: that would stack a
  second Modal on the sheet's. Image-only rows in the inbox read
  `image.photo` ("📷 Photo", in all 13 catalogs); the other new strings are
  `composer.addImage`, `composer.removeImage`, `a11y.openImage` and
  `a11y.closeImage`.

## Translations

When the translation module is on and a post, comment or poll has a
reader-locale translation, `CommunityPost` and `ThreadSheet`'s comment rows
show it by default with a caption line underneath — "Translated from
English · See original" — that toggles back to the original text on tap
(emitting `community_translation_toggled`). `PollBlock` follows the same
`showOriginal` state for its option labels. The display logic is exported
as pure helpers so you can build your own row: `displayText(item,
showOriginal)` picks the translation or the original text, and
`translationLine(t, item, showOriginal)` builds the caption string (or
`null` for an untranslated item) — both typed against the `Translatable`
shape `{ text, translation: { text, sourceLocale } | null }`.

## Gating submissions

`CommunityFeedScreen`'s `beforeCompose` runs when the `+` is tapped, once the
rules are accepted and before the composer opens (nothing has been typed
yet). `ThreadSheet`'s `beforeSubmitComment` (also forwarded by the feed)
intercepts a comment right before it is created. Both are async checks:

```ts
type BeforeCompose = () => Promise<boolean>;

type BeforeSubmitComment = (draft: {
  postId: string;
  body: string;
  image?: LocalImage; // images module
}) => Promise<boolean>;
```

Both props are optional and **default-inert** — omit them and behavior is
byte-identical to before they existed. When present, the SDK `await`s the
promise before its own mutation runs: resolving `true` lets the submit
through (or opens the composer); resolving `false` (or the promise rejecting)
aborts it silently — no mutation, no error UI, the comment draft kept exactly
as typed so the user can retry. A second tap during the await can't fire the
gate twice. Because `beforeCompose` runs before the composer's Modal exists,
it may present its own modal (a sign-in sheet, a paywall) — iOS can't stack
one on the composer.

A typical use is a Superwall paywall that only lets the post through once the
viewer is entitled. **The promise must settle on every path** — entitled,
paywall dismissed, paywall error — otherwise the submit button stays disabled
until the composer remounts:

```tsx
import { usePlacement } from "expo-superwall";

function useGate() {
  const pending = useRef<((ok: boolean) => void) | null>(null);
  const { registerPlacement } = usePlacement({
    onDismiss: (_info, result) => {
      // Dismissed without converting → abort, keep the draft.
      if (result.type !== "purchased" && result.type !== "restored") pending.current?.(false);
    },
    onError: () => pending.current?.(false),
  });
  return (placement: string) =>
    new Promise<boolean>((resolve) => {
      pending.current = resolve;
      registerPlacement({ placement, feature: () => resolve(true) }).catch(() => resolve(false));
    });
}

const gate = useGate();
<CommunityFeedScreen
  onOpenProfile={openProfile}
  beforeCompose={() => gate("community_post")}
  beforeSubmitComment={() => gate("community_comment")}
/>;
```
