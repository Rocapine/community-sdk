// Pre-submit gate hook: lets a host intercept a post/comment submission with
// an async check (e.g. a paywall that resolves once the user is entitled)
// before the SDK's own mutation fires. Pulled out of `ComposerCard.tsx` /
// `ThreadSheet.tsx` into its own file — same rationale as `postCache.ts` —
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
