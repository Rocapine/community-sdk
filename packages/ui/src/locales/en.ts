// English catalog for @rocapine/community-ui.
//
// Ported from Eve's Rhythm's key inventory (i18n/en/community.json in the
// eden-s-rythm repo — comment only, no runtime dependency on that app).
// Flattened to dot keys, `{{x}}` (i18next) interpolation rewritten to this
// package's `{x}` syntax, and `_one`/`_other` suffixes rewritten to `.one`/
// `.other` per the plural scheme in i18n.ts.
//
// Every value below is degendered and de-branded — see task-9-report.md for
// the full old -> new table. Two categories of edit were made:
//  1. Degendering (required by the brief): every "sister"-style phrasing
//     rewritten neutrally, "Eve's News" -> "News".
//  2. De-app-copy (the brief's own global constraint — "no gendered/app
//     copy in code OR catalog values"): app branding ("Eve Rhythm team")
//     removed, and the `prayer` feature's default copy genericized to
//     `reaction` wording, mirroring @rocapine/community-core's own
//     prayer -> reaction generalization (see packages/core/src/models.ts).
//     Hosts that want app-specific verbs (e.g. "prayed for you") supply them
//     via `CommunityUIProvider`'s `translations.overrides`.
export const en: Record<string, string> = {
  title: "Community",

  "topics.news": "News",
  "topics.general": "General",
  "topics.prayer": "Prayer",
  "topics.prayerRequest": "Prayer request",
  "topics.testimony": "Testimony",
  "topics.question": "Question",
  "topics.encouragement": "Encouragement",
  "topics.cycleBody": "Cycle & body",
  "topics.fertility": "Fertility",
  "topics.faith": "Faith",
  "topics.relationships": "Relationships",

  "feed.all": "All",
  "feed.searchPlaceholder": "Search posts…",
  "feed.composePrompt": "Share with the community…",
  "feed.unreachableRetry": "The community is unreachable right now. Pull to retry.",
  "feed.unreachable": "The community is unreachable right now.",
  "feed.noSearchResults": "No posts match your search.",
  "feed.newsEmpty": "Announcements from the team will appear here.",
  "feed.empty": "No posts here yet. Be the first to share.",
  "feed.loadMore": "Load more",
  "feed.newPosts.one": "{count} new post",
  "feed.newPosts.other": "{count} new posts",

  "post.pinned": "Pinned",
  "post.viewMore": "View more",
  "post.viewLess": "View less",
  "post.reaction.received": "{name} reacted to your post",
  "post.reaction.anonymous.one": "Someone reacted to your post",
  "post.reaction.anonymous.other": "{count} people reacted to your post",
  "post.reaction.withOthers.one": "{name} and {count} other reacted to your post",
  "post.reaction.withOthers.other": "{name} and {count} others reacted to your post",

  "thread.comments.one": "{count} comment",
  "thread.comments.other": "{count} comments",
  "thread.loadingComments": "Loading comments…",
  "thread.emptyComments": "Be the first to leave a kind word.",
  "thread.commentPlaceholder": "Add a kind word…",

  "composer.placeholder": "Share a thought, a story, an encouragement…",
  "composer.pollPlaceholder": "Ask your question…",
  "composer.option": "Option {number}",
  "composer.addOption": "Add option",
  "composer.poll": "Poll",
  "composer.removePoll": "Remove poll",
  "composer.post": "POST",

  "poll.votes.one": "{count} vote",
  "poll.votes.other": "{count} votes",
  "poll.tapToVote": "Tap an option to vote",

  "rules.title": "Community guidelines",
  "rules.kind": "Be kind. This is a space of encouragement for everyone.",
  "rules.medical": "No medical advice. Share experiences, not prescriptions.",
  "rules.hateful":
    "No hateful, harassing or explicit content. It is removed and can lead to a ban.",
  "rules.report": "See something off? Report it, or block the author. We review every report.",
  "rules.accept": "I agree, take me in",

  "notice.errorTitle": "Something went wrong",
  "notice.rejectedTitle": "Let's keep it gentle",
  "notice.errorBody":
    "We could not reach the community just now. Please check your connection and try again.",
  "notice.rejectedPostBody":
    "Your post could not be shared because it goes against our community guidelines. This is a space for kindness, encouragement and grace, thank you for helping keep it safe for everyone here.",
  "notice.rejectedCommentBody":
    "Your comment could not be shared because it goes against our community guidelines. This is a space for kindness, encouragement and grace, thank you for helping keep it safe for everyone here.",
  "notice.gotIt": "Got it",

  // "menu.cancel"/"menu.delete" are new (Task 12): the mold/Eve's Alert.alert
  // menus localized these two generic button labels through their own app-wide
  // "common.*" i18n namespace (outside this package); CommunityFeedScreen/
  // ThreadSheet's native block/delete/report menus need them and this
  // package has no such namespace, so they're added here under `menu.*`.
  "menu.cancel": "Cancel",
  "menu.delete": "Delete",
  "menu.deletePostTitle": "Delete this post?",
  "menu.deletePostBody": "It will disappear from the community.",
  "menu.deleteCommentTitle": "Delete this comment?",
  "menu.reportPost": "Report post",
  "menu.reportComment": "Report comment",
  "menu.block": "Block",
  "menu.blockUser": "Block {name}",
  "menu.blockUserConfirmTitle": "Block {name}?",
  "menu.blockUserConfirmBody": "You will never see their posts or comments again.",

  "report.title": "Report this content",
  "report.reasons.spam": "Spam",
  "report.reasons.harassment": "Harassment",
  "report.reasons.hate": "Hateful content",
  "report.reasons.inappropriate": "Inappropriate",
  "report.reasons.other": "Something else",
  "report.detailsPlaceholder": "Anything we should know? (optional)",
  "report.send": "Send report",
  "report.sentTitle": "Thank you",
  "report.sentBody": "Your report was sent. Our team reviews every report.",
  "report.errorTitle": "Couldn't send report",
  "report.errorBody": "Please check your connection and try again.",

  "profile.postsSection": "posts",
  "profile.editProfile": "Edit profile",
  "profile.emptyOwn": "You have not shared anything yet.",
  "profile.emptyOther": "No posts to show yet.",
  "profile.changePhoto": "Change photo",
  "profile.bioLabel": "Bio",
  "profile.bioPlaceholder": "Tell the community a little about you",
  "profile.usernameLabel": "Username",
  "profile.usernamePlaceholder": "yourname",
  "profile.usernameHelper": "3 to 20 characters, letters, numbers and dashes.",
  "profile.photoRejected": "This photo was not accepted. Please choose another one.",
  "profile.bioRejected": "This text was not accepted by moderation.",
  "profile.usernameRejected": "This username was not accepted by moderation.",
  "profile.usernameTaken": "This username is already taken.",
  "profile.usernameInvalid": "Only lowercase letters, numbers and dashes, 3 to 20 characters.",
  "profile.genericError": "Something went wrong. Please try again.",
  "profile.save": "Save",

  "inbox.title": "Notifications",
  "inbox.empty":
    "Nothing here yet. When someone reacts to, likes or comments on your posts, it will show up here.",
  "inbox.someone": "Someone",
  "inbox.liked": "{name} liked your post",
  "inbox.commented": "{name} commented on your post",
  "inbox.reacted": "{name} reacted to your post",
  "inbox.news": "News from {name}",
  "inbox.supportReply": "The support team replied to you",
};
