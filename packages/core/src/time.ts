// Display helpers for feeds. No React Native / Supabase imports: pure, exercised in node (vitest).

const MIN = 60_000;
const HOUR = 3_600_000;

/** Compact relative label: "now", "12m", "5h", "3d". */
export function timeAgo(iso: string, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - Date.parse(iso));
  if (elapsed < MIN) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MIN)}m`;
  if (elapsed < 24 * HOUR) return `${Math.floor(elapsed / HOUR)}h`;
  return `${Math.floor(elapsed / (24 * HOUR))}d`;
}
