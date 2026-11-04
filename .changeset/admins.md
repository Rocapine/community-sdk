---
"@rocapine/community-core": minor
"@rocapine/community-ui": minor
"@rocapine/community": minor
---

**Admin accounts and admin-only topics (breaking).** "Official" accounts are now called
admin accounts everywhere, and any topic can be reserved for them, not only `news`.

- Everyone reads an `adminOnly: true` topic. On its tab a member gets no `+` and never
  sees it in the composer; an admin gets the `+`, with that topic preselected. Its tab
  leads with the `announcement` icon, and its empty state reads `feed.adminTopicEmpty`.
- The database no longer reserves `news` (`core/011_admins.sql`): which topics are
  admin-only is the app's config, applied by the UI.

Migration:

- Run `npx @rocapine/community upgrade`, then `supabase db push`. `profiles.is_official`
  becomes `is_admin`; a read-only `is_official` copy stays for app versions on 0.14 or
  older, and the inbox still names admin posts `official_post` for them (0.15 reads
  both). Make an account admin with `update profiles set is_admin = true where id = …`.
- Renames: `CommunityTopicDef.officialOnly` → `adminOnly`, `isOfficialTopic` →
  `isAdminTopic`, `FeedPost`/`ThreadComment.authorOfficial` → `authorAdmin`,
  `CommunityProfile.official` → `admin`, the `renderAvatar` prop `official` → `admin`,
  the inbox kind `official_post` → `admin_post`, the icon `officialSeal` → `adminSeal`,
  the colors `official`/`officialName` → `admin`/`adminName`, the string
  `feed.newsEmpty` → `feed.adminTopicEmpty`, and `broadcast-post`'s push data kind
  `community_official_post` → `community_admin_post`.
- `composeTopics(admin?)` now takes whether the author is an admin.
