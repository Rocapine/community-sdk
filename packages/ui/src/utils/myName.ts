import { displayName, useCommunityConfig, useMyUid, useProfile } from "@rocapine/community-core";
import { useCallback, useRef } from "react";

/**
 * The name the user posts under: their community profile's (default "Frère
 * 4821", the app's, or their own edit), then the app's, then the label. A
 * getter, so a submit that awaited a host gate reads the latest value.
 */
export function useMyAuthorName(): () => string {
  const cfg = useCommunityConfig();
  const username = useProfile(useMyUid()).data?.username ?? null;
  const ref = useRef(username);
  ref.current = username;
  return useCallback(
    () => displayName(ref.current || cfg.host.getDisplayName(), cfg.authorFallback()),
    [cfg],
  );
}
