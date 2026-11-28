export type { CommunityTheme, DeepPartial, ShadowToken } from "./theme";
export { defaultTheme, mergeTheme } from "./theme";

export type { TFn } from "./i18n";
export { makeT, pluralCategory } from "./i18n";

export type { Translatable } from "./utils/translation";
export { displayText, translationLine } from "./utils/translation";

export { en } from "./locales/en";
export { esES } from "./locales/es-ES";
export { es419 } from "./locales/es-419";
export { fr } from "./locales/fr";
export { frVous } from "./locales/fr-vous";
export { de } from "./locales/de";
export { it } from "./locales/it";
export { pl } from "./locales/pl";
export { ptPT } from "./locales/pt-PT";
export { ptBR } from "./locales/pt-BR";
export { ko } from "./locales/ko";
export { ro } from "./locales/ro";
export { uk } from "./locales/uk";
export { nl } from "./locales/nl";
export { ru } from "./locales/ru";
export { el } from "./locales/el";
export { hu } from "./locales/hu";
export { sv } from "./locales/sv";
export { nb } from "./locales/nb";
export { da } from "./locales/da";
export { hr } from "./locales/hr";
export { sk } from "./locales/sk";
export { cs } from "./locales/cs";

// Re-exported so hosts typing a `renderInboxRow` callback for
// `NotificationInboxScreen` (whose prop signature is
// `(item: InboxItem, defaults: ReactNode | null) => ReactNode`) don't need a
// direct dependency on @rocapine/community-core just for this one type.
export type { InboxItem } from "@rocapine/community-core";

export {
  CommunityUIProvider,
  type CommunityBackground,
  type CommunityTopicStyle,
  useCommunityBackground,
  type AttachmentPlacement,
  type AttachmentVariant,
  type RenderAttachment,
  useCommunityTheme,
  useT,
  useThemedStyles,
  useCommunityIcons,
} from "./ThemeProvider";

export type { CommunityIconName, CommunityIconProps, CommunityIconSet } from "./icons";
export { defaultIcons, mergeIcons } from "./icons-default";

export { CommunitySheet } from "./Sheet";

export type { PostSlots, PostSlotContext, ProfileSource } from "./components/CommunityPost";
export { CommunityPost } from "./components/CommunityPost";
export { Avatar, type AvatarPlacement, type AvatarRenderProps } from "./components/Avatar";
export { defaultMemberBadge, type MemberBadgeRenderProps } from "./components/MemberBadge";
export { ImageViewerHost } from "./components/ImageViewer";
export { PollBlock } from "./components/PollBlock";
export { NoticeCard } from "./components/NoticeCard";
export { PressableScale, haptic, type HapticKind } from "./components/PressableScale";
export { ComposerSheet, canPublish } from "./components/ComposerSheet";
export { RulesSheet } from "./components/RulesSheet";
export type { ReportTarget } from "./components/ReportSheet";
export { ReportSheet } from "./components/ReportSheet";

export { CommunityFeedScreen } from "./screens/CommunityFeedScreen";
export { ConversationScreen, type ConversationScreenProps } from "./screens/ConversationScreen";
export { MessagesScreen, type MessagesScreenProps } from "./screens/MessagesScreen";
export { ExploreGroupsScreen, type ExploreGroupsScreenProps } from "./screens/ExploreGroupsScreen";
export { GroupDetailsScreen, type GroupDetailsScreenProps } from "./screens/GroupDetailsScreen";
export { GroupMembersScreen, type GroupMembersScreenProps } from "./screens/GroupMembersScreen";
export { GroupFormSheet } from "./components/GroupFormSheet";
export {
  DEFAULT_FEED_HEADER,
  type FeedHeaderBackground,
  type FeedHeaderConfig,
  type FeedHeaderItem,
} from "./utils/headerZones";
export { ThreadSheet } from "./screens/ThreadSheet";
export type { CommentGate } from "./utils/gate";
export type { PresentModal } from "./utils/modalHandoff";
export { ProfileScreen } from "./screens/ProfileScreen";
export { BlockedMembersScreen } from "./screens/BlockedMembersScreen";
export { ProfileEditSheet } from "./screens/ProfileEditSheet";
export {
  NotificationInboxScreen,
  type InboxRowMeta,
  type InboxRowParts,
} from "./screens/NotificationInboxScreen";

// Avatar downscale used by `ProfileEditSheet`, for hosts with their own picker.
export { resizeAvatar, AVATAR_SIZE } from "./utils/avatar";
