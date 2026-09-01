// Localized relative-time formatting. Core's `timeAgo` returns a hardcoded
// English compact label ("now"/"12m"/"5h"/"3d"); core stays language-free by
// only exporting the pure `timeAgoParts` decomposition (unit + value, no
// strings), and this package localizes it through its own `time.*` catalog
// keys and the caller's `TFn`.

import { timeAgoParts } from "@rocapine/community-core";
import type { TFn } from "../i18n";

/** Localized compact relative label ("now" / "12m" / "5h" / "3d", or each
 * locale's own compact form — see `time.*` keys in `../locales/*`). */
export function formatTimeAgo(t: TFn, iso: string, nowMs: number): string {
  const parts = timeAgoParts(iso, nowMs);
  if (parts.unit === "now") return t("time.now");
  const key =
    parts.unit === "minute" ? "time.minutes" : parts.unit === "hour" ? "time.hours" : "time.days";
  return t(key, { count: parts.value });
}
