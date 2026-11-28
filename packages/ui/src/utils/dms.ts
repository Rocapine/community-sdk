// Whether a "Message" entry shows. Pure (type-only imports) so it is unit-testable.
import type { DmSource, ResolvedDms } from "@rocapine/community-core";
import type { QueryClient } from "@tanstack/react-query";

/** The "Message" button (`profile`), picker row (`newMessage`) or menu item
 * (`contextMenu`) for `memberId`: never on my own profile, only at an entry point the
 * app turned on (`dms.entryPoints`), only when `useDmFlags` says I may message them (an
 * existing DM, or a new one they accept; with `requireAccount`, they have an account),
 * and never across a block. My own account is not checked here: without one, the tap
 * asks the host for it (`onAccountRequired("dm")`). */
export function canMessage(o: {
  memberId: string;
  me: string | null;
  dms: Pick<ResolvedDms, "entryPoints"> | null;
  entryPoint: DmSource;
  flag: boolean;
  /** A block either way. */
  blocked?: boolean;
}): boolean {
  return (
    !!o.me &&
    o.memberId !== o.me &&
    !!o.dms?.entryPoints.includes(o.entryPoint) &&
    o.flag &&
    !o.blocked
  );
}

/** A member's DM flag for a menu, as cached right now: never waits on the network, so
 * the menu (with Report and Block) opens at once. Unknown ⇒ false for this tap, and a
 * background fetch starts so a later tap knows. */
export function cachedDmFlag(
  queryClient: QueryClient,
  options: { queryKey: readonly unknown[]; queryFn: () => Promise<boolean>; staleTime?: number },
): boolean {
  const flag = queryClient.getQueryData<boolean>(options.queryKey);
  if (flag === undefined) void queryClient.prefetchQuery(options);
  return flag === true;
}
