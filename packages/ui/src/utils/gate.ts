// Pre-submit gate hook: lets a host intercept a comment submission with an
// async check (e.g. a paywall that resolves once the user is entitled)
// before the SDK's own mutation fires. Pulled out of `ThreadSheet.tsx` into
// its own file — same rationale as `postCache.ts` —
// so the merge/abort logic is unit-testable without mocking React Native.
//
// Contract (both call sites are default-inert): no `gate` ⇒ `action` runs
// immediately. `gate` resolves `true` ⇒ `action` runs. `gate` resolves
// `false` ⇒ `action` never runs, and nothing else happens (no error UI, no
// draft mutation — that's the caller's job by simply not clearing state
// inside `action` unless `runGuarded` actually invoked it). A rejecting
// `gate` counts as `false` and is swallowed here so it never surfaces as an
// unhandled promise rejection.
export async function runGuarded<T>(
  gate: ((draft: T) => Promise<boolean>) | undefined,
  draft: T,
  action: () => void,
): Promise<boolean> {
  if (!gate) {
    action();
    return true;
  }

  let allowed: boolean;
  try {
    allowed = await gate(draft);
  } catch {
    allowed = false;
  }

  if (allowed) action();
  return allowed;
}

/** The `+` button's gates, in order, before the composer opens: the community
 * rules (asked for with `requestRules` when not yet accepted, resolving
 * whether they were), then the host's `beforeCompose` (e.g. sign in first).
 * Resolves whether the composer may open; a throwing gate counts as no. */
export async function openComposerGuarded(o: {
  rulesAccepted: boolean;
  requestRules: () => Promise<boolean>;
  beforeCompose?: () => Promise<boolean>;
}): Promise<boolean> {
  try {
    if (!o.rulesAccepted && !(await o.requestRules())) return false;
    return o.beforeCompose ? await o.beforeCompose() : true;
  } catch {
    return false;
  }
}
