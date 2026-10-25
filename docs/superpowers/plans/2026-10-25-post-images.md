# Images in posts and comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can attach one photo from their library to a post or a comment (with or without text), moderated before anyone else sees it, shipped as the opt-in `images` module.

**Architecture:** A new backend module (`supabase/migrations/images/`: three nullable columns on `posts`/`comments`, a public `post-images` bucket, an orphan-listing RPC) installed by the CLI. The client downsizes/re-encodes the photo (strips GPS), uploads it to `post-images/{uid}/{uuid}.jpg`, inserts the pending row with the path and dimensions, then calls `moderate-one`, which now judges text + image in one OpenAI call. The UI renders a frame sized from the stored dimensions, opens a full-screen viewer, and adds image controls to the composer and the thread reply bar.

**Tech Stack:** TypeScript, React Native (Expo), TanStack Query, Supabase (Postgres, Storage, Deno Edge Functions), OpenAI `omni-moderation-latest`, vitest, deno test.

**Spec:** `docs/superpowers/specs/2026-10-25-post-images-design.md`

## Global Constraints

- Opt-in: `modules.images?: boolean`, absent/false ⇒ every query, select and screen byte-identical to 0.10 (Eve and Nightward untouched).
- One image per post, one per comment. Text optional when an image is present; never both a poll and an image on a post.
- Upload: long edge ≤ **1600 px**, JPEG quality **0.8**, re-encoded on device (no EXIF/GPS leaves the phone). Bucket `post-images`: public, `file_size_limit` **2 MB** (2097152), `allowed_mime_types` `['image/jpeg']`, path `{uid}/{uuid}.jpg`, inserts only into the caller's own folder.
- `expo-image-manipulator` is required when `modules.images` is on: without it the image buttons are hidden (and a one-time `console.warn` in dev). Never upload an un-re-encoded original.
- Feed frame: inside card padding, `theme.radii.md` corners, aspect kept, height capped at **4:5** (w:h); wide images floored at **1.91:1** (my call for panoramas — center-cropped beyond). Comment frame: max width **60%** of the comment column, same caps.
- Image-only items store `content = ''` (column stays NOT NULL).
- Moderation: one verdict for text + image; image categories ignore `MODERATION_EXCLUDED_CATEGORIES`. Hidden ⇒ file kept. `sexual/minors` on the image ⇒ object deleted at once. Author delete / row gone ⇒ file removed by the daily sweep (shortcut: up to 24 h later, same sweep as unreferenced uploads).
- Push/inbox excerpt of an image-only item: localized "Photo".
- Analytics: existing `postPublished` / `commentPublished` events gain `hasImage: boolean` (camelCase like the existing `hasPoll`). No new event names.
- Every new UI string in all 13 catalogs (`packages/ui/src/locales/*.ts`); icon-only buttons carry `accessibilityRole`/`accessibilityLabel`.
- Press feedback rules (0.10): `PressableScale` only on visible surfaces, no opacity on press, haptic only on commits.
- Backend migration must be idempotent (`if not exists`, `drop … if exists` then create) — it gets applied to the sandbox before Unchaind's `community upgrade` copies it again.
- CI: `npm run build && npm run typecheck && npm test && npx prettier --check .`, plus `deno test` on `_shared/` and `deno check` on every function.

## Review Focus

1. **A portrait iPhone photo (EXIF orientation 6) must arrive upright** after re-encoding, in the composer thumbnail, the feed and the viewer → Task 7 checks `prepareImage` output dimensions are post-rotation; Task 12 QA step uses a real portrait photo.
2. **Extreme aspect ratios** (10:1 panorama, 1:3 screenshot) must not produce a 30-px sliver or a screen-tall card → Task 7 `imageFrame` tests pin the 1.91:1 floor and the 4:5 cap.
3. **Upload fails offline** → the optimistic item disappears and the draft comes back _with its image_, nothing half-created on the server → Task 6 hook test (upload rejects ⇒ `createPost` never called) and Task 9/10 restore the `image` in the draft.
4. **Picker cancelled / no photo access** → nothing happens, no error notice, the draft is untouched → Task 7 `pickImage` returns `null` on cancel.
5. **Image-only items in pushes and inbox** never render as `Marie: ""` or an empty row → Task 4 (push copy) and Task 8 (inbox label) tests.

---

### Task 1: Backend `images` module + CLI registration

**Files:**

- Create: `supabase/migrations/images/001_images.sql`
- Modify: `packages/cli/src/install-shared.ts:17` (`MODULE_ORDER`)
- Modify: `packages/cli/src/commands/upgrade.ts` (post-install notes, near line 353)
- Test: `packages/cli/src/__tests__/init.test.ts`, `packages/cli/src/__tests__/upgrade.test.ts`

**Interfaces:**

- Produces (DB): `posts.image_path text`, `posts.image_width int`, `posts.image_height int`; same three on `comments`. Bucket `post-images`. RPC `public.post_images_unreferenced(p_limit int default 500) returns setof text` (security definer, service role only): object names in `post-images` older than 24 h not referenced by any `posts`/`comments` row whose `status <> 'deleted'`.
- Produces (CLI): module name `"images"`, `MODULE_ORDER = ["core", "push", "polls", "reaction", "inbox", "translation", "images"]`. No new functions.

- [ ] **Step 1: Write the failing CLI tests**

In `init.test.ts`: `it("installs the images migration when the images module is selected")` — run init with `modules: ["images"]` into a temp dir; expect a file matching `/_community_images_images\.sql$/` under `migrations/` and `manifest.modules` toEqual `["core", "images"]`.
In `upgrade.test.ts`: `it("adds the images module to an existing install with addModules")` — init with `["core"]`, then `runUpgrade({ addModules: ["images"] })`; expect `manifest.modules` toEqual `["core", "images"]` and `manifest.installedTemplates` toContain `"images/images"`.

- [ ] **Step 2: Run them — expect FAIL** (`unknown module "images"`)

Run: `npm test -w @rocapine/community`

- [ ] **Step 3: Write `supabase/migrations/images/001_images.sql`**

Header comment in the style of `core/005_avatars.sql`. Contents, all idempotent:

- `alter table … add column if not exists` for the six columns; checks (named, `drop constraint if exists` first): `image_width`/`image_height` both null or both > 0, set iff `image_path` is set.
- Replace `posts_content_check` with `char_length(content) <= 2000 and (char_length(content) >= 1 or image_path is not null)`; `comments_content_check` likewise with 1000. (Verify the live constraint names with `\d posts` on the sandbox in Task 12; the CREATE TABLE in `core/001_tables.sql` leaves them auto-named.)
- `grant insert (image_path, image_width, image_height)` on both tables to `authenticated` (posts already uses column-scoped grants, `core/002_rls.sql:91-92`; do the same for comments if it does).
- A **restrictive** insert policy per table: `image_path is null or (storage.foldername(image_path))[1] = auth.uid()::text`.
- Bucket insert `on conflict do nothing`; storage insert policy "post image upload to own folder" (copy of the avatars one, `drop policy if exists` first). No update/delete policies.
- The `post_images_unreferenced` function; `revoke all … from public, anon, authenticated`.

- [ ] **Step 4: Register the module**

Append `"images"` to `MODULE_ORDER`. In upgrade/init post-install notes add one line: `images module: requires expo-image-manipulator in the app; no secret`.

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm run build -w @rocapine/community && npm test -w @rocapine/community` (prebuild copies `supabase/` into `templates/`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/images packages/cli/src
git commit -m "feat(cli): images module migration"
```

---

### Task 2: Moderation of text + image with strict image categories

**Files:**

- Modify: `supabase/functions/_shared/moderation.ts`
- Create: `supabase/functions/_shared/moderation_test.ts`

**Interfaces:**

- Produces:
  - `export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };` (`ImageInput` becomes `ContentPart[]`, kept as an alias for `update-profile`).
  - `ModerationResult` gains optional `category_applied_input_types?: Record<string, ("text" | "image")[]>`.
  - `export function flaggedCategories(result: ModerationResult): string[]` — unchanged for text; for a category whose applied types include `"image"`, the score check uses the full `CATEGORIES_TO_HIDE` list (exclusions ignored).
  - `export function moderateInput(input: string | ContentPart[]): Promise<{ flagged: boolean; reason: string | null; categories: string[]; imageCategories: string[] } | null>` — `imageCategories` = flagged categories applied to the image.
  - `export function moderationParts(text: string, imageUrl: string | null): string | ContentPart[]` — text only ⇒ the string (unchanged request shape); image ⇒ `[text part if non-empty, image part]`.

- [ ] **Step 1: Write the failing tests** (`moderation_test.ts`, set `MODERATION_EXCLUDED_CATEGORIES=sexual` via `Deno.env.set` _before_ a dynamic `await import("./moderation.ts")`)

- `sexual score 0.6 applied to text only, excluded ⇒ not flagged` → `flaggedCategories(...)` equals `[]`.
- `sexual score 0.6 applied to image ⇒ flagged` → equals `["sexual"]`.
- `moderationParts("hi", null)` equals `"hi"`; `moderationParts("", "https://x/a.jpg")` equals `[{ type: "image_url", image_url: { url: "https://x/a.jpg" } }]`; `moderationParts("hi", "https://x/a.jpg")` has length 2, text first.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd supabase/functions && deno test --config deno.json --no-lock --allow-env _shared/moderation_test.ts`

- [ ] **Step 3: Implement** the signatures above. `moderateInput` reads `results[0].category_applied_input_types` when present.

- [ ] **Step 4: Run all `_shared` tests — expect PASS**

Run: `cd supabase/functions && deno test --config deno.json --no-lock --allow-env _shared/`

- [ ] **Step 5: Commit** — `feat(functions): moderate images strictly alongside text`

---

### Task 3: `moderate-one` and `daily-moderation` handle images; orphan sweep

**Files:**

- Modify: `supabase/functions/moderate-one/index.ts`
- Modify: `supabase/functions/daily-moderation/index.ts`
- Create (if not already shared): `supabase/functions/_shared/images.ts`

**Interfaces:**

- Consumes: Task 2 `moderateInput`, `moderationParts`; Task 1 columns and `post_images_unreferenced`.
- Produces: `_shared/images.ts` → `export const POST_IMAGES_BUCKET = "post-images"; export function postImageUrl(path: string): string` (`${SUPABASE_URL}/storage/v1/object/public/post-images/${path}`) and `export async function fetchImagePath(supabase, table: "posts" | "comments", id: string): Promise<string | null>` (separate select of `image_path`; any error ⇒ `null`, so installs without the module behave as before).

- [ ] **Step 1: Write a failing test for `postImageUrl`** in `_shared/images_test.ts`: `postImageUrl("u1/a.jpg")` ends with `/storage/v1/object/public/post-images/u1/a.jpg`. Run, expect FAIL, implement `_shared/images.ts`, run, expect PASS.

- [ ] **Step 2: `moderate-one`** — after the poll-label merge, `const imagePath = await fetchImagePath(...)`; `moderateInput(moderationParts(input, imagePath && postImageUrl(imagePath)))`. When `verdict.imageCategories` includes `"sexual/minors"`, `storage.from(POST_IMAGES_BUCKET).remove([imagePath])` before writing the hidden status. Response shape unchanged.

- [ ] **Step 3: `daily-moderation`** — items that have an `image_path` are excluded from the text batch and moderated one by one through `moderateInput(moderationParts(...))` (same stamp/hide/Slack handling, same `sexual/minors` deletion). Then the orphan sweep: `rpc("post_images_unreferenced", { p_limit: 500 })`; on error skip silently (module not installed); otherwise `remove(names)` and add the count to the Slack summary.

- [ ] **Step 4: Verify**

Run: `cd supabase/functions && deno check --config deno.json --no-lock */index.ts && deno test --config deno.json --no-lock --allow-env _shared/`
Expected: no type errors, all tests pass. (Live behavior is checked in Task 12.)

- [ ] **Step 5: Commit** — `feat(functions): image moderation and unreferenced image sweep`

---

### Task 4: Excerpts, reports and translation for image-only items

**Files:**

- Modify: `supabase/functions/_shared/copy.ts`, `supabase/functions/_shared/copy_test.ts`
- Modify: `supabase/functions/notify-comment/index.ts`, `supabase/functions/broadcast-post/index.ts`
- Modify: `supabase/functions/report-to-slack/index.ts`
- Modify: `supabase/functions/_shared/translation.ts`, `supabase/functions/_shared/translation_test.ts`

**Interfaces:**

- Consumes: Task 3 `fetchImagePath`, `postImageUrl`.
- Produces: `PushCopyKey` gains `"photo"` (built-in for every locale in `BUILTIN`: en "📷 Photo", fr "📷 Photo", de "📷 Foto", es-ES/es-419 "📷 Foto", it "📷 Foto", pl "📷 Zdjęcie", pt-PT/pt-BR "📷 Foto", ko "📷 사진", ro "📷 Fotografie", uk "📷 Фото" — match whatever locale keys `BUILTIN` already has).
  `export function excerptOrPhoto(content: string, photo: string): string` in `copy.ts` — the existing 140-char truncation, or `photo` when `content.trim()` is empty.

- [ ] **Step 1: Failing tests** in `copy_test.ts`: `pushCopy("fr").text("photo")` equals `"📷 Photo"`; `excerptOrPhoto("", "📷 Photo")` equals `"📷 Photo"`; `excerptOrPhoto("a".repeat(200), "x")` has length 140 and ends with `"..."`. In `translation_test.ts`: whatever pure helper decides an item needs translating returns "nothing to translate" for `content: ""` (no OpenAI call, no endless re-pick by `daily-translation`).

- [ ] **Step 2: Run — expect FAIL**, implement, run `deno test … _shared/` — expect PASS.

- [ ] **Step 3: Wire it**: `notify-comment` body becomes `${name}: "${excerpt}"` for text and `${name}: ${photo}` for an image-only comment; `broadcast-post` body uses `excerptOrPhoto`. `report-to-slack` appends the image URL line when `fetchImagePath` returns a path. `translate-one` / `ensureTranslations` short-circuit on empty content.

- [ ] **Step 4: Verify** — `deno check … */index.ts` and `deno test … _shared/` pass.

- [ ] **Step 5: Commit** — `feat(functions): photo excerpts, report image link, skip empty translations`

---

### Task 5: Core — config, models and service

**Files:**

- Modify: `packages/core/src/config.ts` (`CommunityModules`)
- Modify: `packages/core/src/models.ts`
- Modify: `packages/core/src/service.ts`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/__tests__/models.test.ts`, `packages/core/src/__tests__/service.test.ts`

**Interfaces:**

- Produces:
  - `CommunityModules.images?: boolean`.
  - `export interface PostImage { url: string; width: number; height: number }` — `url` is the public URL, or a local `file://` uri on optimistic items.
  - `export type LocalImage = PostImage` (a re-encoded local file, ready to upload).
  - `FeedPost.image: PostImage | null`, `ThreadComment.image: PostImage | null`.
  - `PostRow` / `CommentRow` gain optional `image_path?: string | null; image_width?: number | null; image_height?: number | null`.
  - `export function mapImage(row: { image_path?: string | null; image_width?: number | null; image_height?: number | null }, imageBase: string | undefined): PostImage | null` — `null` unless all three are set and `imageBase` is given; `url = imageBase + image_path`.
  - `mapPostRow(..., transformPost?, imageBase?: string)` (new trailing param) and `mapCommentRow(row, myUid, fallback, imageBase?: string)`.
  - `buildFeedSelect(extraPostColumns?, polls = false, translations = false, images = false)` — appends `"image_path, image_width, image_height"` before the extra columns when `images`. `threadSelect(cfg)` appends the same three when `cfg.modules.images`.
  - `export const POST_IMAGES_BUCKET = "post-images";`
  - `export async function uploadPostImage(cfg, image: LocalImage): Promise<{ path: string; width: number; height: number }>` — path `${uid}/${uuid}.jpg` (`crypto.randomUUID` if available, else a timestamp+random fallback), `contentType: "image/jpeg"`, same fetch→arrayBuffer pattern as `uploadAvatar`.
  - `CreatePostInput` gains `image?: { path: string; width: number; height: number }`; `createPost` inserts `image_path/image_width/image_height`; throws `"images module is not enabled"` if `image` without `cfg.modules.images`, and `"a post cannot have both a poll and an image"` if both.
  - `createComment(cfg, postId, body, image?)` — same columns.
  - Internal `imageBase(cfg): string | undefined` — `undefined` when the module is off, else `client.storage.from(POST_IMAGES_BUCKET).getPublicUrl("").data.publicUrl` normalized to end with `/`.

- [ ] **Step 1: Failing tests**

`service.test.ts`: `buildFeedSelect(undefined, false, false, false)` not toContain `"image_path"`; `buildFeedSelect(undefined, false, false, true)` toContain `"image_path, image_width, image_height"`; `buildFeedSelect(["seed_likes"], false, false, true)` ends with `"image_height, seed_likes"`; `threadSelect` with `modules.images: true` toContain `"image_path"`, without it not.
`models.test.ts`: `mapImage({ image_path: "u/a.jpg", image_width: 1200, image_height: 1600 }, "https://x/post-images/")` toEqual `{ url: "https://x/post-images/u/a.jpg", width: 1200, height: 1600 }`; `mapImage({ image_path: "u/a.jpg", image_width: null, image_height: null }, "https://x/")` toBe `null`; `mapImage({ image_path: "u/a.jpg", image_width: 1, image_height: 1 }, undefined)` toBe `null`; `mapPostRow` on a row without image fields gives `image: null`; `mapCommentRow(row, uid, "x", base)` maps the image.

- [ ] **Step 2: Run — expect FAIL** — `npm test -w @rocapine/community-core`

- [ ] **Step 3: Implement** the interfaces above; pass `imageBase(cfg)` from `toFeedPosts` and `fetchThread`.

- [ ] **Step 4: Run — expect PASS** — `npm test -w @rocapine/community-core && npm run typecheck -w @rocapine/community-core`

- [ ] **Step 5: Commit** — `feat(core): images module data layer`

---

### Task 6: Core — create hooks with images

**Files:**

- Modify: `packages/core/src/hooks.ts` (`useCreatePost` ~371, `useCreateComment` ~471)
- Test: `packages/core/src/__tests__/optimistic.test.ts`

**Interfaces:**

- Consumes: Task 5 `uploadPostImage`, `createPost`, `createComment`, `LocalImage`.
- Produces: `useCreatePost` variables `{ topic; text; authorName; pollOptions?; image?: LocalImage }`; `useCreateComment` variables `{ postId; text; authorName; image?: LocalImage }`. Optimistic item `image` = the `LocalImage` (local uri). `mutationFn`: `uploadPostImage` first, then create, then `moderateOne`. On publish the item's `image` is swapped to the server `PostImage` by a background `invalidateQueries` on the feed/thread key (same as the poll case), so the local file uri never outlives the session. Events: `postPublished` gets `hasImage`, `commentPublished` gets `hasImage`; `bodyLength` unchanged.

- [ ] **Step 1: Failing tests** (follow the existing mocking style in `optimistic.test.ts`):
  - `it("uploads the image before inserting the post")` — call order: `uploadPostImage` then `createPost` with `image: { path, width, height }`.
  - `it("does not create the post when the upload fails")` — `uploadPostImage` rejects ⇒ `createPost` not called, optimistic post removed from every feed page.
  - `it("reports hasImage on postPublished")` — `onEvent` called with `expect.objectContaining({ hasImage: true })`.
  - Same three for comments (thread cache, `commentPublished`).

- [ ] **Step 2: Run — expect FAIL**; **Step 3: implement**; **Step 4: run — expect PASS** (`npm test -w @rocapine/community-core`).

- [ ] **Step 5: Commit** — `feat(core): optimistic posts and comments with an image`

---

### Task 7: UI — image utilities and strings

**Files:**

- Create: `packages/ui/src/utils/postImage.ts`
- Create: `packages/ui/src/__tests__/postImage.test.ts`
- Modify: `packages/ui/src/locales/*.ts` (13 catalogs)
- Modify: `packages/ui/package.json` (peer meta comment only if needed — `expo-image-manipulator` stays an optional peer; its requirement is runtime, per module)

**Interfaces:**

- Consumes: core `LocalImage`, `PostImage`.
- Produces:
  - `export const IMAGE_MAX_EDGE = 1600; export const IMAGE_MIN_RATIO = 4 / 5; export const IMAGE_MAX_RATIO = 1.91;`
  - `export function imageFrame(image: { width: number; height: number }, maxWidth: number): { width: number; height: number }` — width = `maxWidth`, height = `maxWidth / clamp(w/h, IMAGE_MIN_RATIO, IMAGE_MAX_RATIO)`, rounded.
  - `export function imagesSupported(): boolean` — `expo-image-manipulator` loadable (lazy `require`, same pattern as `utils/avatar.ts`) When it returns `false`, log a one-time `console.warn` in `__DEV__` saying the images module needs `expo-image-manipulator`.
  - `export async function prepareImage(uri: string): Promise<LocalImage | null>` — re-encode to JPEG 0.8, resize so the long edge ≤ `IMAGE_MAX_EDGE` (never upscale); returns the _rendered_ width/height (post-orientation); `null` if the manipulator is missing or fails. Never returns the original uri.
  - `export async function pickImage(): Promise<LocalImage | null>` — `expo-image-picker` `launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, exif: false })`; cancelled / no asset ⇒ `null`; else `prepareImage(asset.uri)`.
  - Catalog keys (every catalog, translated, `fr-vous` only where the register differs): `"composer.addImage"` (a11y label, en "Add an image"), `"composer.removeImage"` (en "Remove image"), `"image.photo"` (en "📷 Photo", same values as Task 4), `"a11y.openImage"` (en "Open image"), `"a11y.closeImage"` (en "Close").

- [ ] **Step 1: Failing tests** (`postImage.test.ts`):
  - `imageFrame({ width: 1200, height: 1600 }, 300)` toEqual `{ width: 300, height: 375 }` (3:4 is taller than 4:5 ⇒ capped).
  - `imageFrame({ width: 1600, height: 1200 }, 300)` toEqual `{ width: 300, height: 225 }` (landscape whole).
  - `imageFrame({ width: 10000, height: 1000 }, 300)` toEqual `{ width: 300, height: 157 }` (floored at 1.91:1).
  - `imageFrame({ width: 1000, height: 3000 }, 300)` toEqual `{ width: 300, height: 375 }`.
  - With `expo-image-manipulator` mocked absent: `prepareImage("file://a.jpg")` resolves `null`; `imagesSupported()` is `false`.
  - With the picker mocked as cancelled: `pickImage()` resolves `null`.
  - i18n parity test (existing `i18n.test.ts`) passes with the new keys.

- [ ] **Step 2: Run — expect FAIL** — `npm test -w @rocapine/community-ui`
- [ ] **Step 3: Implement**; **Step 4: run — expect PASS** (+ `npm run typecheck -w @rocapine/community-ui`).
- [ ] **Step 5: Commit** — `feat(ui): image helpers and strings`

---

### Task 8: UI — image in post cards, full-screen viewer, inbox label

**Files:**

- Create: `packages/ui/src/components/PostImage.tsx`
- Create: `packages/ui/src/components/ImageViewer.tsx`
- Modify: `packages/ui/src/Sheet.tsx` (`CommunitySheet` gets `overlay?: ReactNode`)
- Modify: `packages/ui/src/components/CommunityPost.tsx`
- Modify: `packages/ui/src/screens/CommunityFeedScreen.tsx`, `ProfileScreen.tsx`, `ThreadSheet.tsx` (mount the viewer host)
- Modify: `packages/ui/src/screens/NotificationInboxScreen.tsx` (~line 212)

**Interfaces:**

- Consumes: Task 7 `imageFrame`, core `PostImage`.
- Produces:
  - `PostImage({ image, maxWidth, onOpen }: { image: PostImage; maxWidth: number; onOpen: (image: PostImage) => void })` — `expo-image` `Image`, `contentFit="cover"`, frame from `imageFrame` (reserved before load), `borderRadius: theme.radii.md`, `accessibilityRole="imagebutton"`, label `t("a11y.openImage")`.
  - `ImageViewerContext: React.Context<(image: PostImage) => void>` and `ImageViewerHost({ children }: { children: ReactNode })` renders the viewer in an RN `Modal` (feed, profile) and provides the context. `useImageViewerOverlay(): { open: (image: PostImage) => void; overlay: ReactNode }` is for `ThreadSheet`, which provides `open` through the context and passes `overlay` to `CommunitySheet` so the viewer renders inside the sheet's existing Modal as an absolute full-screen layer — **never a second Modal over the thread** (the 0.4.2 freeze).
  - Viewer: black background, pinch-to-zoom and double-tap zoom (Gesture Handler + Reanimated), swipe down to close, close button labelled `t("a11y.closeImage")`, respects `useReducedMotion` for the dismiss animation.
  - `CommunityPost`: text block rendered only when `post.text` is non-empty; `PostImage` under it (`maxWidth` = card inner width) when `post.image`.
  - Inbox: when `postExcerpt === ""`, show `t("image.photo")`.

- [ ] **Step 1: Failing test** — extend `__tests__/postCache.test.ts` or add a pure test for the inbox label helper: `inboxExcerpt("", t)` returns `t("image.photo")`; `inboxExcerpt(null, t)` returns `null`; `inboxExcerpt("hi", t)` returns `"hi"`. (Extract `inboxExcerpt` into `NotificationInboxScreen.tsx`'s module or `utils/`.)
- [ ] **Step 2: Run — FAIL**; **Step 3: implement** the components and wiring; **Step 4: run** `npm test -w @rocapine/community-ui && npm run typecheck -w @rocapine/community-ui` — PASS.
- [ ] **Step 5: Verify on the example app** — `examples/expo-app` with `modules.images: true` (Task 11 config): a seeded image post renders at its final size with no jump; tap opens the viewer from the feed and from inside a thread; closing the viewer inside a thread leaves the thread open and touchable.
- [ ] **Step 6: Commit** — `feat(ui): post images and full-screen viewer`

---

### Task 9: UI — composer image flow

**Files:**

- Modify: `packages/ui/src/components/ComposerCard.tsx`
- Modify: `packages/ui/src/screens/CommunityFeedScreen.tsx` (failed-draft restore passes the image back)

**Interfaces:**

- Consumes: Task 6 `useCreatePost` `image`, Task 7 `pickImage`, `imagesSupported`, `imageFrame`.
- Produces: `ComposerCard` internal state `image: LocalImage | null`; `beforeSubmit` draft type gains `image?: LocalImage`; `onPublishFailed` restore puts back `{ text, pollDraft, image }`.

Behavior (spec §2, Guillaume's correction):

- The row inside the text box that today shows the topic select while composing becomes: **Image button left-aligned**, topic select stays right. The Image button is an icon-only `Pressable` (no `PressableScale`, it has no surface) with `t("composer.addImage")`, shown only when `cfg.modules.images && imagesSupported() && pollDraft === null`. If `topics.length <= 1` the row still renders for the Image button.
- Picking an image shows a thumbnail under the text (inside `AnimatedHeight`), `imageFrame` at a 120-pt max width, with a ✕ (`t("composer.removeImage")`). Tapping Image again replaces it.
- While an image is attached, the footer Poll toggle is disabled (greyed, `accessibilityState={{ disabled: true }}`).
- `canPost = (text.trim().length > 0 || image !== null) && !pollInvalid && !pending && !gating`.
- Publish haptic unchanged; the image adds no haptic.

- [ ] **Step 1: Implement** (logic is UI state; `canPost` extracted as a pure `canPublish({ text, image, pollInvalid, pending, gating })` in the same file and unit-tested: image-only ⇒ true; empty text and no image ⇒ false; image + `pollInvalid` ⇒ false).
- [ ] **Step 2: Run** `npm test -w @rocapine/community-ui && npm run typecheck -w @rocapine/community-ui` — PASS.
- [ ] **Step 3: Verify on the example app**: image-only post publishes; text + image publishes; offline (airplane mode) publish brings the draft back with the image; poll mode hides the Image button; image attached greys out Poll; picker cancel leaves the draft untouched.
- [ ] **Step 4: Commit** — `feat(ui): attach an image from the composer`

---

### Task 10: UI — comments with an image

**Files:**

- Modify: `packages/ui/src/screens/ThreadSheet.tsx` (comment row ~line 500, reply bar ~line 409)

**Interfaces:**

- Consumes: Task 6 `useCreateComment` `image`, Task 7 helpers, Task 8 `PostImage` + viewer overlay.

Behavior (spec §2):

- Comment row: text only when non-empty; `PostImage` with `maxWidth = 0.6 × comment column width`.
- Reply bar: the user's avatar on the left becomes the add-image button **while the field is focused or an image is attached** (icon-only, label `t("composer.addImage")`, only when `cfg.modules.images && imagesSupported()`); otherwise the avatar as today.
- Attached image: 56-pt thumbnail above the bar with a ✕; tapping the button again replaces it.
- Send enabled with text or image; a failed/rejected comment restores text **and** image.

- [ ] **Step 1: Implement**; **Step 2: run** `npm test -w @rocapine/community-ui && npm run typecheck -w @rocapine/community-ui` — PASS.
- [ ] **Step 3: Verify on the example app**: image-only and text+image comments; keyboard closed with an image attached keeps the button visible; viewer opens over the thread without closing it.
- [ ] **Step 4: Commit** — `feat(ui): images in comments`

---

### Task 11: Docs, example app, changeset

**Files:**

- Modify: `README.md`, `packages/core/README.md`, `packages/ui/README.md`, `packages/cli/README.md`, `docs/integration.md`, `docs/backend-runbook.md`
- Modify: `examples/expo-app` config (`modules.images: true`) and its dependencies (`expo-image-manipulator`)
- Create: `.changeset/post-images.md` (minor: `@rocapine/community-core`, `@rocapine/community-ui`, `@rocapine/community`)

- [ ] **Step 1:** Document: the module, its requirement (`expo-image-manipulator` ⇒ native build), `community upgrade --add-modules images` then `supabase db push`, what moderators see (image URL in Slack reports; the dashboard is out of scope), file lifecycle (kept on hide, swept after author deletion within 24 h, `sexual/minors` deleted at once). Changeset text in the style of 0.10.0's.
- [ ] **Step 2:** `npx prettier --write .` then `npm run build && npm run typecheck && npm test && npx prettier --check .` — all green.
- [ ] **Step 3: Commit** — `docs: images module`

---

### Task 12: Live verification on the Unchaind sandbox, PR

The SDK repo has no local backend (no Docker). Live checks run against the Unchaind sandbox `vjcdpodsrpemanfvrshh` (deploys allowed; prod `doiafuhoourjtqsmzook` is Guillaume's only).

- [ ] **Step 1:** Apply `images/001_images.sql` to the sandbox (Supabase MCP `apply_migration`), deploy `moderate-one`, `daily-moderation`, `notify-comment`, `broadcast-post`, `report-to-slack`, `translate-one`, `daily-translation` (one at a time — multi-deploy 500s). Confirm the content-check constraint names first.
- [ ] **Step 2:** On a Unchaind worktree with `@rocapine/community-*` packed from this branch, `modules.images: true`, `expo-image-manipulator` installed and a **new dev client build** (native dep): run the four behaviors, a portrait iPhone photo (Review Focus 1), a panorama, an offline publish, an image-only comment push (excerpt "📷 Photo"), a report (Slack shows the URL), and a self-hidden test item via the dashboard restore. Check `storage.objects` after an author delete + manual `daily-moderation` run: the file is gone.
- [ ] **Step 3:** Record the walkthrough (screen recording, compressed per the PR-video rule), open the SDK PR with it, and hand Guillaume the local test setup. **Do not merge** until he has tested it; release (`npm run release`) is his.

---

### Task 13 (after Guillaume publishes to npm): Unchaind consumption PR

- [ ] Branch from Unchaind `main`; bump `@rocapine/community-core`/`-ui` to the published version; `npx expo install expo-image-manipulator`.
- [ ] `services/community/communityConfig.ts`: `modules.images: true`. `npx @rocapine/community upgrade --add-modules images` (in a scratch copy first, then the worktree), commit the generated migration and `community-sdk.json`.
- [ ] Push copy: add the `photo` key to `scripts/communityPushCopy.mjs` output if Unchaind overrides push copy per key (otherwise the built-ins apply).
- [ ] `docs/features/COMMUNITY.md`: map row for images, the native-dependency note (1.15 build must include it), lifecycle rules.
- [ ] `supabase db push` + functions deploy on the sandbox; walkthrough recording; PR for Guillaume. Prod migration/deploy is his.
