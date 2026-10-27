// Localized relative-time formatting. Core's `timeAgo` returns a hardcoded
// English compact label ("now"/"12m"/"5h"/"3d"); core stays language-free by
// only exporting the pure `timeAgoParts` decomposition (unit + value, no
// strings), and this package localizes it through its own `time.*` catalog
// keys and the caller's `TFn`.

import { timeAgoParts } from "@rocapine/community-core";
import { useSyncExternalStore } from "react";
import type { TFn } from "../i18n";

const UNIT_KEYS = {
  second: "time.seconds",
  minute: "time.minutes",
  hour: "time.hours",
  day: "time.days",
  month: "time.months",
  year: "time.years",
} as const;

/** Localized compact relative label ("now" / "30s" / "12m" / "5h" / "3d" /
 * "2mo" / "1y", or each locale's own compact form — see `time.*` keys in
 * `../locales/*`). */
export function formatTimeAgo(t: TFn, iso: string, nowMs: number): string {
  const parts = timeAgoParts(iso, nowMs);
  if (parts.unit === "now") return t("time.now");
  return t(UNIT_KEYS[parts.unit], { count: parts.value });
}

export type ClockResolution = "minute" | "second";

/** The clock a timestamp needs: per-second while its label still counts
 * seconds (under a minute old), per-minute after that. */
export function secondsResolution(iso: string, nowMs: number): ClockResolution {
  return nowMs - Date.parse(iso) < 60_000 ? "second" : "minute";
}

// One shared clock per resolution for every relative timestamp on screen
// ("2m" → "3m"): a single interval each, started with the first subscriber
// and stopped with the last, so a long feed doesn't run one timer per row.
function makeClock(intervalMs: number) {
  let nowMs = Date.now();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (!timer) {
      nowMs = Date.now();
      timer = setInterval(() => {
        nowMs = Date.now();
        listeners.forEach((l) => l());
      }, intervalMs);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }

  return { subscribe, get: () => nowMs };
}

const clocks = { minute: makeClock(60_000), second: makeClock(1_000) };

/** Current time, re-rendering the caller once a minute (or once a second with
 * `"second"`, for a label that still counts seconds). */
export function useNow(resolution: ClockResolution = "minute"): number {
  const clock = clocks[resolution];
  return useSyncExternalStore(clock.subscribe, clock.get);
}
