// Display helpers for feeds. No React Native / Supabase imports: pure, exercised in node (vitest).

const SEC = 1_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Pure, language-free decomposition of an elapsed duration, for a consumer
 * (e.g. `@rocapine/community-ui`'s `formatTimeAgo`) to localize into its own
 * catalog. `unit: "now"` carries no `value` worth formatting. */
export type TimeAgoParts =
  | { unit: "now"; value: 0 }
  | { unit: "second" | "minute" | "hour" | "day" | "month" | "year"; value: number };

/** Decompose `iso` relative to `nowMs` into a unit + count, with no language
 * baked in — see `timeAgo` for the hardcoded-English string this replaces
 * core-internally, kept for back-compat. Each unit gives way to the next as
 * soon as that one reaches 1 (59s → 1m); a month is 30 days and caps at 11 so
 * it never reads "12mo" before "1y" (365 days). A future `iso` (clock skew) is
 * "now". */
export function timeAgoParts(iso: string, nowMs: number): TimeAgoParts {
  const elapsed = Math.max(0, nowMs - Date.parse(iso));
  if (elapsed < SEC) return { unit: "now", value: 0 };
  if (elapsed < MIN) return { unit: "second", value: Math.floor(elapsed / SEC) };
  if (elapsed < HOUR) return { unit: "minute", value: Math.floor(elapsed / MIN) };
  if (elapsed < DAY) return { unit: "hour", value: Math.floor(elapsed / HOUR) };
  const days = Math.floor(elapsed / DAY);
  if (days < 30) return { unit: "day", value: days };
  if (days < 365) return { unit: "month", value: Math.min(Math.floor(days / 30), 11) };
  return { unit: "year", value: Math.floor(days / 365) };
}

const COMPACT_SUFFIX = { second: "s", minute: "m", hour: "h", day: "d", month: "mo", year: "y" };

/**
 * Compact relative label: "now", "30s", "12m", "5h", "3d", "2mo", "1y".
 * Hardcoded English — kept for back-compat, but `@rocapine/community-ui` no
 * longer calls this itself; it localizes through `timeAgoParts` + its own
 * catalog instead (see `formatTimeAgo` in the ui package).
 */
export function timeAgo(iso: string, nowMs: number): string {
  const parts = timeAgoParts(iso, nowMs);
  if (parts.unit === "now") return "now";
  return `${parts.value}${COMPACT_SUFFIX[parts.unit]}`;
}
