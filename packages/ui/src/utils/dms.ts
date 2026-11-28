// Whether a "Message" entry shows. Pure (type-only core import) so it is unit-testable.
import type { DmSource, ResolvedDms } from "@rocapine/community-core";

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
