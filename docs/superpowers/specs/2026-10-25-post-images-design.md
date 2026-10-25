# Images in posts and comments — design

Date: 2026-10-25. Status: approved by Guillaume 2026-10-25, awaiting implementation plan.
Scope: `@rocapine/community-core`, `@rocapine/community-ui`, `@rocapine/community` (CLI) and the
Supabase backend templates. First consumer: Unchaind (main is on SDK 0.10.x; its 1.15 isn't
released yet). Flow: SDK PR → Guillaume publishes to npm → separate Unchaind PR that consumes it.

## 1. Intent

Members can share a photo from their photo library in the community: one image per post and
one image per comment, alone or with text. The image is moderated like the text, before anyone
else sees it.

## 2. Decisions taken with Guillaume

| Question                  | Decision                                                                                                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What can be shared        | Any image from the photo library. No in-app camera, no forced crop.                                                                                                                                                                                                           |
| How many                  | At most **one** image per post and **one** per comment (v1; may be raised later).                                                                                                                                                                                             |
| Text                      | Optional when an image is attached: image-only posts and comments are allowed. Text-only stays as today.                                                                                                                                                                      |
| Moderation                | The image goes through moderation like any post: text and image are judged together and get **one** verdict. Rejected ⇒ the post/comment is hidden as today; the image file is **kept** (the dashboard's restore must bring it back).                                         |
| Privacy                   | The image is downscaled and re-encoded as JPEG on the device before upload, which also strips EXIF/GPS metadata.                                                                                                                                                              |
| Storage                   | A new public bucket `post-images`, modeled on `avatars`. The file lives as long as its post/comment: deleted when the author deletes the item (or the row goes), never on a hide. Exception: an image flagged `sexual/minors` is deleted at once (no illegal content stored). |
| Image + poll              | Not combined: a post carries a poll **or** an image, never both.                                                                                                                                                                                                              |
| Push and inbox excerpts   | When the item has no text, the excerpt shows a localized "Photo" label.                                                                                                                                                                                                       |
| Release                   | Rides in Unchaind **1.15** (not shipped yet; it's the build that introduces the in-house community, so no installed client predates images). The 1.15 native build must include `expo-image-manipulator`.                                                                     |
| Moderation dashboard      | **Out of scope**: it keeps showing text only.                                                                                                                                                                                                                                 |
| Translation               | Unchanged; only text is translated.                                                                                                                                                                                                                                           |
| Feed rendering            | Mockup **A**: inside the card's padding, rounded corners, aspect ratio kept, height capped at **4:5** (taller images are center-cropped to 4:5; landscape images show whole). Tapping opens it full screen.                                                                   |
| Composer (feed)           | The **Image** button sits in the same row as the topic select (the row inside the text box, shown while composing), **left-aligned**; the topic select stays where it is, on the right. The Image button is not shown while a poll is open.                                   |
| Composer preview          | The chosen image shows as a thumbnail under the text with a ✕ to remove it. Tapping Image again replaces it. Publish is enabled with text **or** an image.                                                                                                                    |
| Comments                  | Image shown smaller than in the feed (max ≈ 60% of the comment column width, same 4:5 cap), tap ⇒ full screen. In the reply bar, while the field is focused, **the user's avatar on the left becomes the add-image button**.                                                  |
| Comment reply bar preview | The chosen image shows as a small thumbnail above the bar with a ✕. While an image is attached the image button stays shown even if the keyboard closes, so the reply visibly isn't empty. Tapping it again replaces the image.                                               |
| Sending                   | Same as today: the item appears immediately (local image), goes through moderation; on rejection or network failure the draft comes back **with its image**.                                                                                                                  |

Mockups (local, not committed): `.superpowers/brainstorm/*/content/feed-image.html`,
`compose-and-comments.html`, `compose-v2.html`. Note: in `compose-v2.html` neither composer
option is the chosen one; the composer row described above (Guillaume's correction) is.

## 3. Goals, non-goals, anti-goals

Goals: the four behaviors above (post with image, image-only post, comment with image,
image-only comment), moderated before publication, on iOS and Android, in every catalog locale.

Non-goals (v1):

- More than one image, video, GIF animation (an animated file is re-encoded to its first frame),
  in-app camera, crop/filters/editing.
- Image + poll on the same post.
- Editing an image after publication (posts and comments aren't editable today anyway).
- Per-app corner radius / spacing presets and the edge-to-edge image variant (**B**) — a
  separate follow-up Guillaume wants later; build the image component so a host theme could
  later switch it to edge-to-edge without a rewrite, but don't build that option now.
- Searching images, alt text written by users.

Anti-goals (would be a failure even if it works):

- Anyone other than the author seeing an image before it's approved.
- An image's location metadata reaching the server.
- A layout jump when an image loads in the feed (the frame must have its final size before the
  pixels arrive).
- Hosts that don't opt in (Eve, Nightward) seeing any change in behavior, queries or UI.

## 4. Constraints from the existing code

- Optional modules are the SDK's pattern (`modules.polls`, `push`, `inbox`, `reaction`,
  `translation` in `packages/core/src/config.ts`; matching `supabase/migrations/<module>/`,
  copied by the CLI and recorded in `community-sdk.json`). Images follow it (see §5).
- `posts.content` and `comments.content` are `not null check (char_length(content) between 1 and …)`
  (`core/001_tables.sql`): image-only items need that check relaxed to "text or image present".
- `moderate-one` judges a post's text and its poll labels as one input; `_shared/moderation.ts`
  `moderateInput` already accepts an `image_url` part (used by `update-profile` for avatars,
  fetched from the public bucket URL). `daily-moderation` batches text-only inputs today; images
  need their own calls there (the OpenAI moderation endpoint takes a limited number of images per
  request).
- `avatars` (`core/005_avatars.sql`): public bucket, JPEG only, size cap, inserts only into the
  caller's own folder, deletions done by Edge Functions with the service role. An unapproved
  object is reachable by its unguessable URL until judged — accepted there, accepted here too.
- `expo-image-picker` and `expo-image-manipulator` are already optional peers of the UI package
  (avatar upload, `resizeAvatar`). The OS photo pickers used by `expo-image-picker` need no
  library permission prompt.
- The composer and thread are tuned (0.10 UI/UX pass): press feedback rules, own placeholder,
  `AnimatedHeight`, failed-draft restore, optimistic items with `isOptimistic`. The new controls
  follow the same rules (PressableScale only on surfaces, haptic on commit, a11y labels on
  icon-only buttons, every new string in all catalogs).
- `prettier --check .` runs in CI.

## 5. Calls made by me (Claude), for Guillaume to check while reading

1. **Opt-in module `modules.images`** (default off), with `supabase/migrations/images/` installed
   by `community init/upgrade`. Unchaind turns it on; Eve and Nightward are untouched.
2. **Upload size**: long edge downscaled to 1600 px, JPEG quality ~0.8; bucket cap 2 MB,
   `image/jpeg` only. Downscaling needs `expo-image-manipulator`, which becomes **required when
   `modules.images` is on** (it's what strips the GPS data) — the UI hides the image buttons and
   warns once in dev if it's missing.
3. **Image dimensions stored** with the post/comment (width/height) so the feed reserves the
   right frame before loading — the anti-goal on layout jumps.
4. **Upload order**: upload the file first, then insert the pending row referencing its path,
   then `moderate-one`. Path `post-images/{uid}/{uuid}.jpg`. Files never referenced by a row
   (app killed between the two steps) are removed by the daily sweep after 24 h.
5. **Blocked authors / reports**: images follow their post/comment (hidden with it); the Slack
   report message includes the image URL so a human can see what was reported.
6. **Account deletion**: no change to what happens to a deleted account's posts; their images
   follow the posts.
7. **Full-screen viewer**: built in the UI package with the peers it already requires
   (Gesture Handler, Reanimated, expo-image): pinch-to-zoom, swipe down to close. No new
   dependency. Opening it from inside `ThreadSheet` must use `ctx.presentModal`-style handoff —
   a Modal over the thread Modal froze the app before (0.4.2 bug).
8. **Images are moderated strictly, whatever the text policy.** `MODERATION_EXCLUDED_CATEGORIES`
   exists so an app can let people _talk_ about sex/addiction (plausible for Unchaind); it must not
   loosen image moderation. An item with an image gets two OpenAI calls (free): the text with the
   normal rules, the image alone with the full `SCORE_HIDE` list; one verdict = union. (A single
   combined call can't tell which part drove a score.) Avatars become strict the same way.
   OpenAI scores `sexual/minors` on text only, so the "delete at once" rule applies to an item whose
   verdict includes `sexual/minors` and that carries an image. Same rules in `daily-moderation`.
9. **Image-only items store `content = ''`** with the column kept NOT NULL (check relaxed to
   "text or image"), so an older SDK client reading the row never gets a null string.
10. **Analytics**: existing post/comment events gain a `has_image` boolean; no new event names
    (one tracking plan across apps).

## 6. Left to the builder

Exact schema (column names, the relaxed check), the moderation call shape in `moderate-one` and
`daily-moderation`, query/select changes (only when the module is on, like polls/translation),
the image component's internals, cache handling of optimistic images, test split, changeset
(minor for core/ui/cli), and the Unchaind consumption PR (enable the module, `community upgrade`,
`db push` on the sandbox `vjcdpodsrpemanfvrshh`; prod `doiafuhoourjtqsmzook` is Guillaume's).

Process constraints: Guillaume tests UI changes himself on a local setup before any merge or
release; every PR with a visible change embeds a screen recording.
