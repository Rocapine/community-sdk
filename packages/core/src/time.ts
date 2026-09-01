// Display helpers for feeds. No React Native / Supabase imports: pure, exercised in node (vitest).

const MIN = 60_000;
const HOUR = 3_600_000;

/** Pure, language-free decomposition of an elapsed duration, for a consumer
 * (e.g. `@rocapine/community-ui`'s `formatTimeAgo`) to localize into its own
 * catalog. `unit: "now"` carries no `value` worth formatting. */
export type TimeAgoParts =
  { unit: "now"; value: 0 } | { unit: "minute" | "hour" | "day"; value: number };

/** Decompose `iso` relative to `nowMs` into a unit + count, with no language
 * baked in — see `timeAgo` for the hardcoded-English string this replaces
 * core-internally, kept for back-compat. */
export function timeAgoParts(iso: string, nowMs: number): TimeAgoParts {
  const elapsed = Math.max(0, nowMs - Date.parse(iso));
  if (elapsed < MIN) return { unit: "now", value: 0 };
  if (elapsed < HOUR) return { unit: "minute", value: Math.floor(elapsed / MIN) };
  if (elapsed < 24 * HOUR) return { unit: "hour", value: Math.floor(elapsed / HOUR) };
  return { unit: "day", value: Math.floor(elapsed / (24 * HOUR)) };
}

/**
 * Compact relative label: "now", "12m", "5h", "3d". Hardcoded English —
 * kept for back-compat, but `@rocapine/community-ui` no longer calls this
 * itself; it localizes through `timeAgoParts` + its own catalog instead (see
 * `formatTimeAgo` in the ui package).
 */
export function timeAgo(iso: string, nowMs: number): string {
  const parts = timeAgoParts(iso, nowMs);
  if (parts.unit === "now") return "now";
  return `${parts.value}${parts.unit === "minute" ? "m" : parts.unit === "hour" ? "h" : "d"}`;
}
