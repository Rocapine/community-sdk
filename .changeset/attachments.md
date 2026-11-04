---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

Attachments. A post can carry one reference to the app's own content (`{ type, id }`: a
verse, a recipe, a session), never a URL: each reader's app draws the card from its own
data with `renderAttachment(attachment, { placement, open })` and opens it with
`onOpenAttachment` (both on `CommunityUIProvider`). Configure it with
`modules.attachments: { types, membersCanAttach }`; official accounts can always attach.
Share from the app with `CommunityFeedScreen`'s `composeRequest`
(`{ attachment?, text?, requestedAt }`): the composer opens with the card, through the same
gates as `+`. A post carries an attachment, a poll or a photo, never two; with an
attachment the text may be empty.

New backend module `attachments` (`posts.attachment`, shape and size checked). The images
module's content check now keeps the attachment clause, whichever is installed first.
Core: `createPost({ attachment })`, `FeedPost.attachment`, `canAttach`, `PostAttachment`.
UI: `canPublish` takes `hasAttachment`; new string `composer.removeAttachment`.
