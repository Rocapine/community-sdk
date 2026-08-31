// Dev-only schema drift check. Reads the single `community_meta.schema_version`
// row and warns when it doesn't match what this SDK version expects, so a host
// developer notices a stale backend migration during development. This is a
// diagnostic aid, not a runtime gate — it must never throw and must never run
// in production (RN's global `__DEV__` gate, same convention every host app
// already relies on for dev-only logging).

import type { ResolvedCommunityConfig } from "./config";

/** Bump whenever the SDK's expected `community_meta` shape changes. */
export const REQUIRED_SCHEMA_VERSION = 1;

declare const __DEV__: boolean | undefined;

/**
 * Read path, exported separately from the `__DEV__` gate so tests — where
 * `__DEV__` is `undefined` under vitest/Node, not `false` — can exercise the
 * four behaviors (mismatch warns, match is silent, query error is silent,
 * degraded mode is silent) directly. `checkSchemaVersion` below is the only
 * symbol wired into `CommunityProvider`; this one stays package-internal
 * (not re-exported from `index.ts`).
 */
export async function checkSchemaVersionUnguarded(cfg: ResolvedCommunityConfig): Promise<void> {
  const client = cfg.supabase;
  if (!client) return; // degraded mode (no backend configured) — nothing to check

  try {
    const { data, error } = await client
      .from("community_meta")
      .select("schema_version")
      .maybeSingle();
    if (error) return; // e.g. table doesn't exist yet on this backend — silent

    const version = (data as { schema_version?: number } | null)?.schema_version;
    if (version !== undefined && version !== REQUIRED_SCHEMA_VERSION) {
      console.warn(
        `[@rocapine/community-core] community_meta.schema_version is ${version}, this SDK expects ${REQUIRED_SCHEMA_VERSION}. Run the latest backend migrations.`,
      );
    }
  } catch {
    // network error or unexpected client shape — never throw from a dev diagnostic
  }
}

/**
 * Dev-only entry point, called once from `CommunityProvider`'s mount effect.
 * No-ops outside dev (production RN bundles define `__DEV__ === false`; a
 * plain Node/test environment leaves it `undefined`, which also no-ops here —
 * see `checkSchemaVersionUnguarded` for how tests reach the read path).
 */
export async function checkSchemaVersion(cfg: ResolvedCommunityConfig): Promise<void> {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    await checkSchemaVersionUnguarded(cfg);
  }
}
