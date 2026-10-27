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
// ("2m" → "3m"): a single interval each, started with the first subscriber and
// stopped with the last, so a long feed doesn't run one timer per row. Both
// read one `nowMs`, so a row moving from the second clock to the minute one
// ("59s" → "1m") never reads an older time than it just showed.
export function makeClocks() {
  let nowMs = Date.now();
  const make = (intervalMs: number) => {
    const listeners = new Set<() => void>();
    let timer: ReturnType<typeof setInterval> | null = null;
    return {
      subscribe(listener: () => void): () => void {
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
      },
    };
  };
  const clocks = { minute: make(60_000), second: make(1_000) };
  return {
    subscribe: (resolution: ClockResolution, listener: () => void) =>
      clocks[resolution].subscribe(listener),
    get: (_resolution: ClockResolution) => nowMs,
  };
}

const clocks = makeClocks();
const subscribers = {
  minute: (l: () => void) => clocks.subscribe("minute", l),
  second: (l: () => void) => clocks.subscribe("second", l),
};

/** Current time, re-rendering the caller once a minute (or once a second with
 * `"second"`, for a label that still counts seconds). */
export function useNow(resolution: ClockResolution = "minute"): number {
  return useSyncExternalStore(subscribers[resolution], () => clocks.get(resolution));
}
