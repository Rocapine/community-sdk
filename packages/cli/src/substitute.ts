/**
 * Replaces the `__SUPABASE_PROJECT_URL__` / `__SUPABASE_ANON_KEY__` placeholders
 * baked into the shipped migration SQL (see core/003, push/002, reaction/001)
 * with the values for the app's own Supabase project.
 *
 * Throws if any `__SUPABASE...` token remains after substitution — a guard
 * against a third, unhandled placeholder silently reaching the app's
 * migrations directory (the migration's own DO block re-checks this at
 * `db push` time, but failing fast here gives a clearer error before any
 * SQL is written to disk).
 */
export function substitutePlaceholders(
  sql: string,
  values: { projectUrl: string; anonKey: string },
): string {
  const result = sql
    .split("__SUPABASE_PROJECT_URL__")
    .join(values.projectUrl)
    .split("__SUPABASE_ANON_KEY__")
    .join(values.anonKey);

  if (result.includes("__SUPABASE")) {
    throw new Error(
      "community-sdk: unsubstituted __SUPABASE placeholder remains after substitution",
    );
  }

  return result;
}
