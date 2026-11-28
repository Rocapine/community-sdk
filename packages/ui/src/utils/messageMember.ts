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
import { useEffect } from "react";
import { Alert, type AlertButton } from "react-native";
import { useT } from "../ThemeProvider";
import { cachedDmFlag, canMessage } from "./dms";
import { needsAccount } from "./groups";

export type OpenDm = (target: { conversationId: string }) => void;

/** `message(memberId, source)` opens (or creates) my DM with them through `onOpen`;
 * `menuItems(memberId)` is the "Message" item for a post or comment menu (none when the
 * `contextMenu` entry point is off, the member can't be messaged, or their flag isn't
 * known yet: the menu never waits for it). Without `onOpen`, there is nothing to open:
 * no item. */
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

  const menuItems = (memberId: string): AlertButton[] => {
    const rule = { memberId, me, dms, entryPoint: "contextMenu" as const };
    if (!onOpen || !memberId || !canMessage({ ...rule, flag: true })) return [];
    const flag = cachedDmFlag(queryClient, dmFlagQueryOptions(cfg, memberId));
    return canMessage({ ...rule, flag })
      ? [{ text: t("dms.message"), onPress: () => message(memberId, "contextMenu") }]
      : [];
  };

  return { message, menuItems, accountMissing, pending: startDm.isPending };
}

/** Warms the DM flags of the members a screen shows (post and comment authors), in the
 * background, so their menus can offer "Message" at the first tap. Nothing with dms or
 * the `contextMenu` entry point off. */
export function usePrefetchDmFlags(ids: readonly string[]): void {
  const cfg = useCommunityConfig();
  const queryClient = useQueryClient();
  const on = !!dmsSettings(cfg)?.entryPoints.includes("contextMenu");
  const key = on ? [...new Set(ids)].filter(Boolean).join() : "";
  useEffect(() => {
    // Batched into one profile_dm_flags call; fresh flags (60 s) aren't fetched again.
    for (const id of key ? key.split(",") : [])
      void queryClient.prefetchQuery(dmFlagQueryOptions(cfg, id));
  }, [cfg, queryClient, key]);
}
