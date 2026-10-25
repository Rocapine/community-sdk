---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

Images in posts and comments (opt-in module `images`).

core: `modules.images: true`. One photo per post and per comment, alone or with text; a post carries a poll or an image, never both. `createPost` / `createComment` and `useCreatePost` / `useCreateComment` take an image (`LocalImage`, uploaded with `uploadPostImage` to the public `post-images` bucket, `POST_IMAGES_BUCKET`); optimistic items show the local file until the refetch. `FeedPost.image` and `ThreadComment.image` (`PostImage | null`, `mapImage`). `postPublished` and `commentPublished` gain `hasImage`. BREAKING (types) for hosts that build `FeedPost` / `ThreadComment` literals by hand: add `image: null`.

ui: composer Image button next to the topic select (hidden while a poll is open), thumbnail with a remove button; feed image inside the card (rounded, aspect kept, 4:5 cap, 1.91:1 floor, final frame before load); full-screen viewer (pinch and double-tap zoom, swipe down to close; inside a thread it is an overlay within the sheet — a host rendering `CommunityPost` in its own `CommunitySheet` must not wrap it in `ImageViewerHost`); comment images at most 60% wide; the reply-bar avatar becomes the add-image button while the field is focused; inbox rows for image-only items read "📷 Photo" (new strings in all 13 catalogs). New icon role `image` — a host that types a complete `CommunityIconSet` must add it (at runtime a missing role falls back to the default); the composer's Poll toggle now carries `accessibilityRole` / `accessibilityState`. Requires `expo-image-manipulator` (native module ⇒ new build): photos are re-encoded on device (JPEG 0.8, long edge ≤ 1600 px), which strips EXIF/GPS; without it the image buttons are hidden and a dev build warns once.

cli: new module `images` (`images/001_images.sql`: columns, the `post-images` bucket — 2 MB, JPEG only, own folder — and the sweep RPC) and `translation/003_skip_empty.sql` (the translation sweep skips image-only items). Upgrade: `npx @rocapine/community upgrade --add-modules images`, `supabase db push`, redeploy the functions.

functions: an item with an image gets a text call (normal rules) and an image-only call (strict: `MODERATION_EXCLUDED_CATEGORIES` never applies to images); lookup errors fail closed. BEHAVIOR CHANGE: avatars are moderated strictly the same way, so apps that set `MODERATION_EXCLUDED_CATEGORIES` get stricter avatar checks. A hidden item keeps its file (dashboard restore works); an item whose verdict includes `sexual/minors` and that carries an image has its file deleted at once; files of author-deleted items and unreferenced uploads are removed by `daily-moderation` once older than 24 h. Pushes and inbox read "📷 Photo" for an image-only item (new push copy key `photo`, overridable through `COMMUNITY_PUSH_COPY`); Slack reports include the image URL. The moderation dashboard is unchanged (text only).
