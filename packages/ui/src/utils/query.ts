// Shared degraded-mode loading gate. TanStack Query v5: a query created with
// `enabled: false` (this package's degraded-mode contract — every list/detail
// hook in `@rocapine/community-core` gates on `cfg.supabase !== null`, see
// `packages/core/src/hooks.ts`) never fetches, so it sits at
// `status: "pending"` / `fetchStatus: "idle"` forever. A screen that branches
// its spinner on `isPending` alone renders that spinner forever instead of
// falling through to its empty state — the degraded-mode acceptance test
// (task brief's Global Constraint) requires the empty state instead. Gating
// on `fetchStatus !== "idle"` too (the officially-documented pattern for
// combining `enabled` with loading UI) fixes it: "never asked to fetch" no
// longer reads as "still loading".
export function isQueryLoading(query: { isPending: boolean; fetchStatus: string }): boolean {
  return query.isPending && query.fetchStatus !== "idle";
}
