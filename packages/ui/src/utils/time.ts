// Localized relative-time formatting. Core's `timeAgo` returns a hardcoded
// English compact label ("now"/"12m"/"5h"/"3d"); core stays language-free by
// only exporting the pure `timeAgoParts` decomposition (unit + value, no
// strings), and this package localizes it through its own `time.*` catalog
// keys and the caller's `TFn`.

import { timeAgoParts } from "@rocapine/community-core";
import { useSyncExternalStore } from "react";
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

// One shared 60s clock for every relative timestamp on screen ("2m" → "3m"):
// a single interval, started with the first subscriber and stopped with the
// last, so a long feed doesn't run one timer per row.
let nowMs = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribeNow(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    nowMs = Date.now();
    timer = setInterval(() => {
      nowMs = Date.now();
      listeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time, re-rendering the caller once a minute. */
export function useNow(): number {
  return useSyncExternalStore(subscribeNow, () => nowMs);
}
