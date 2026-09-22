// Shared "has this user accepted the community rules" flag, so every gate in
// the UI (the feed composer, the thread's comment box, a host-mounted
// `RulesSheet` behind an info button) reads and updates ONE value instead of
// each component snapshotting `cfg.host.rulesAcceptance.get()` on mount.
// Without this, accepting the rules from a host's own `RulesSheet` left the
// composer locked until remount and made the user accept twice.
//
// The host adapter stays the source of truth on disk: this is an in-memory
// mirror, (re)loaded once per `cfg` identity and flipped by
// `markRulesAccepted()` from `RulesSheet` after `rulesAcceptance.set()`.

import type { ResolvedCommunityConfig } from "@rocapine/community-core";
import { useEffect, useSyncExternalStore } from "react";

let accepted = false;
let loadedFor: ResolvedCommunityConfig | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Flip the shared flag to accepted (idempotent). Called by `RulesSheet` after
 * the host adapter persisted the acceptance. */
export function markRulesAccepted(): void {
  if (accepted) return;
  accepted = true;
  emit();
}

/** Load the persisted acceptance for `cfg` (once per config identity) and
 * subscribe to later changes. Starts locked until the adapter answers, so a
 * gate is never open for a frame before the state is actually known. */
export function useRulesAccepted(cfg: ResolvedCommunityConfig): boolean {
  useEffect(() => {
    if (loadedFor === cfg) return;
    loadedFor = cfg;
    cfg.host.rulesAcceptance
      .get()
      .then((ok) => {
        if (loadedFor !== cfg) return;
        if (ok !== accepted) {
          accepted = ok;
          emit();
        }
      })
      .catch(() => {});
  }, [cfg]);
  return useSyncExternalStore(
    subscribe,
    () => accepted,
    () => accepted,
  );
}

/** Test-only: forget the loaded state between test cases. */
export function _resetRulesAcceptanceForTests(): void {
  accepted = false;
  loadedFor = null;
}
