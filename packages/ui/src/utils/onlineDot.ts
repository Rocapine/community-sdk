/** Green dot size and the ring (cut-out) around it, from the avatar's size. */
export function onlineDotMetrics(size: number): { dot: number; ring: number } {
  return { dot: Math.max(8, Math.round(size * 0.26)), ring: size >= 48 ? 3 : 2 };
}
