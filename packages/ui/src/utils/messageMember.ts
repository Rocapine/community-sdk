// Starting a DM from an entry point ("Message" on a profile, in a post or comment
// menu, a row of the "new message" picker): the account check, `startDm`, then the
// host opens the conversation.
import {
  dmFlagQueryOptions,
  dmsSettings,
  MessagingError,
  useAccountLinked,
  useCommunityConfig,
  useMyUid,
  useStartDm,
  type DmSource,
} from "@rocapine/community-core";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, type AlertButton } from "react-native";
import { useT } from "../ThemeProvider";
import { canMessage } from "./dms";
import { needsAccount } from "./groups";

export type OpenDm = (target: { conversationId: string }) => void;

/** `message(memberId, source)` opens (or creates) my DM with them through `onOpen`;
 * `menuItems(memberId)` is the "Message" item for a post or comment menu (none when the
 * `contextMenu` entry point is off or the member can't be messaged). Without `onOpen`,
 * there is nothing to open: no item. */
export function useMessageMember(onOpen: OpenDm | undefined) {
  const cfg = useCommunityConfig();
  const t = useT();
  const queryClient = useQueryClient();
  const me = useMyUid();
  const linked = useAccountLinked();
  const startDm = useStartDm();
  const dms = dmsSettings(cfg);

  // With `requireAccount`, the entry points show without my account: a tap asks for it.
  const accountMissing = needsAccount(dms?.requireAccount === true, linked);

  const message = (recipientId: string, source: DmSource) => {
    if (!onOpen || startDm.isPending) return;
    if (accountMissing) return cfg.host.onAccountRequired?.("dm");
    startDm.mutate(
      { recipientId, source },
      {
        onSuccess: (conversationId) => onOpen({ conversationId }),
        onError: (e) => {
          const code = e instanceof MessagingError ? e.code : "unknown";
          if (code === "account_required") cfg.host.onAccountRequired?.("dm");
          else
            Alert.alert(
              t(code === "too_many_requests" ? "dms.error.tooManyRequests" : "dms.request.error"),
            );
        },
      },
    );
  };

  const menuItems = async (memberId: string): Promise<AlertButton[]> => {
    const rule = { memberId, me, dms, entryPoint: "contextMenu" as const };
    if (!onOpen || !memberId || !canMessage({ ...rule, flag: true })) return [];
    // Cached for a minute (the profile button and earlier menus share it).
    const flag = await queryClient.fetchQuery(dmFlagQueryOptions(cfg, memberId)).catch(() => false);
    return canMessage({ ...rule, flag })
      ? [{ text: t("dms.message"), onPress: () => message(memberId, "contextMenu") }]
      : [];
  };

  return { message, menuItems, accountMissing, pending: startDm.isPending };
}
