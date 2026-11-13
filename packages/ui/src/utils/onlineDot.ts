/** Only members shown in content get a presence lookup (and a dot): not the header,
 * composer, reply bar, edit preview or the blocked list (the server answers false). */
const ONLINE_PLACEMENTS: readonly string[] = ["post", "comment", "profile"];

/** The id to look up for this placement, or null for no lookup. */
export function onlineLookupId(placement: string, userId: string | null): string | null {
  return ONLINE_PLACEMENTS.includes(placement) ? userId : null;
}

/** Green dot size and the ring (cut-out) around it, from the avatar's size. */
export function onlineDotMetrics(size: number): { dot: number; ring: number } {
  return { dot: Math.max(8, Math.round(size * 0.26)), ring: size >= 48 ? 3 : 2 };
}
