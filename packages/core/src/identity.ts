import type { ResolvedCommunityConfig } from "./config";

// One anonymous Supabase identity per install. signInAnonymously() runs once;
// afterwards getSession() restores the same user (and uuid) from AsyncStorage.
// Ported from the mold's lib/community-identity.ts — see the design spec for
// what changed crossing the host-adapter seam.

let inFlight: Promise<string | null> | null = null;
let lastSyncedUsername: string | null = null;
let lastSyncedLocale: string | null = null;
let lastSyncedAnalyticsKey: string | null = null;
let lastSyncedStreakKey: string | null = null;

/**
 * Resolve the community user id, signing in anonymously on first use.
 * Never rejects: resolves to null when offline, when anonymous sign-ins are
 * off, or when the host never configured a Supabase client (degraded mode) —
 * the next call retries.
 */
export function ensureIdentity(cfg: ResolvedCommunityConfig): Promise<string | null> {
  if (!cfg.supabase) return Promise.resolve(null);
  inFlight ??= bootstrap(cfg).catch(() => {
    inFlight = null; // allow a retry on the next call
    return null;
  });
  return inFlight;
}

/**
 * Drops the memoized identity (and every dedupe memo) so the next
 * ensureIdentity() re-reads the (possibly different) session. Call after any
 * host auth transition: login/SSO replaces the anonymous uid, logout needs a
 * fresh anonymous identity.
 */
export function resetIdentity(): void {
  inFlight = null;
  lastSyncedUsername = null;
  lastSyncedLocale = null;
  lastSyncedAnalyticsKey = null;
  lastSyncedStreakKey = null;
}

async function bootstrap(cfg: ResolvedCommunityConfig): Promise<string> {
  const client = cfg.requireClient();
  const { data } = await client.auth.getSession();
  if (data.session) {
    await assignDefaultProfile(cfg);
    return data.session.user.id;
  }

  const { data: signIn, error } = await client.auth.signInAnonymously();
  if (error || !signIn.user) throw error ?? new Error("anonymous sign-in returned no user");
  const uid = signIn.user.id;

  // Enrich the trigger-created profile so moderation alerts can identify the
  // account (repeat offenders, account value). Best effort.
  const { amplitudeId, revenuecatId } = cfg.host.getAnalyticsIds();
  await client
    .from("profiles")
    .update({ amplitude_id: amplitudeId ?? null, revenuecat_id: revenuecatId ?? null })
    .eq("id", uid);
  await assignDefaultProfile(cfg);
  return uid;
}

/**
 * Give the profile its default name and handle ("Frère 4821" / "@brother-4821")
 * when it has none yet — once per launch, idempotent server-side (core/009).
 * Best effort: an older backend without the RPC keeps the label-only fallback.
 */
async function assignDefaultProfile(cfg: ResolvedCommunityConfig): Promise<void> {
  const { label, handle } = cfg.defaultName;
  try {
    await cfg.requireClient().rpc("assign_default_profile", {
      p_label: typeof label === "function" ? label(cfg.host.getLocale()) : label,
      p_handle: handle,
    });
  } catch {
    // Offline or older backend: retried on the next launch.
  }
}

/**
 * Account deletion: put the default name and handle back and clear bio,
 * avatar and the user's own edits, so kept posts no longer carry the
 * pseudonym. Resolves false when the backend could not be reached.
 */
export async function resetProfileIdentity(cfg: ResolvedCommunityConfig): Promise<boolean> {
  if (!cfg.supabase) return false;
  if (cfg.modules.streaks) {
    const uid = (await cfg.supabase.auth.getSession()).data.session?.user.id;
    if (uid) {
      await cfg.supabase
        .from("profiles")
        .update({ streak_started_at: null, best_streak_days: null })
        .eq("id", uid);
      lastSyncedStreakKey = null;
    }
  }
  const { error } = await cfg.supabase.rpc("reset_profile_identity");
  return !error;
}

/**
 * Mirror the host's display name, locale, analytics ids and streak onto the
 * profiles row. Safe to call on every app open / community open: each field
 * hits the network at most once per launch per changed value (mold pattern
 * from syncCommunityUsername / syncProfileLocale), batched into one update.
 * No-op in degraded mode (no Supabase client configured).
 */
export async function syncProfileFromHost(cfg: ResolvedCommunityConfig): Promise<void> {
  if (!cfg.supabase) return;

  const name = cfg.host.getDisplayName()?.trim() || null;
  const locale = cfg.host.getLocale();
  const { amplitudeId, revenuecatId } = cfg.host.getAnalyticsIds();
  const analyticsKey = JSON.stringify({
    amplitudeId: amplitudeId ?? null,
    revenuecatId: revenuecatId ?? null,
  });

  const update: Record<string, unknown> = {};
  if (name && name !== lastSyncedUsername) update.username = name;
  // profiles.locale only exists when the push module's migration ran
  // (push/001_push.sql) — writing it on a core-only install fails the
  // update with an unknown-column error.
  if (cfg.modules.push && locale !== lastSyncedLocale) update.locale = locale;
  if (analyticsKey !== lastSyncedAnalyticsKey) {
    update.amplitude_id = amplitudeId ?? null;
    update.revenuecat_id = revenuecatId ?? null;
  }
  const streak = cfg.modules.streaks ? cfg.host.getStreak() : null;
  const streakKey = streak ? JSON.stringify(streak) : null;
  if (streak && streakKey !== lastSyncedStreakKey) {
    update.streak_started_at = streak.startedAt;
    update.best_streak_days = Math.max(0, Math.floor(streak.bestDays));
  }
  if (Object.keys(update).length === 0) return;

  const uid = await ensureIdentity(cfg);
  if (!uid) return;

  const client = cfg.requireClient();
  const { error } = await client.from("profiles").update(update).eq("id", uid);
  if (!error) {
    if ("username" in update) lastSyncedUsername = name;
    if ("locale" in update) lastSyncedLocale = locale;
    if ("amplitude_id" in update) lastSyncedAnalyticsKey = analyticsKey;
    if ("streak_started_at" in update) lastSyncedStreakKey = streakKey;
  }
}
