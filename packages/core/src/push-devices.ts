import type { ResolvedCommunityConfig } from "./config";
import { adoptionSettled, ensureIdentity } from "./identity";

/**
 * Register this device's Expo push token on the member's profile: one
 * `push_devices` row per (profile, `host.getInstallId()`), so a member signed in
 * on several devices gets the push on each, plus the profile's `push_tokens` row
 * (the notification preferences) with no legacy token. No-op without an install
 * id or an identity; rejects on a backend error.
 */
export async function registerPushDevice(
  cfg: ResolvedCommunityConfig,
  token: string,
): Promise<void> {
  const deviceId = cfg.host.getInstallId();
  if (!deviceId || !cfg.supabase) return;
  const uid = await ensureIdentity(cfg);
  if (!uid) return;
  const { error } = await cfg.supabase.from("push_devices").upsert({
    user_id: uid,
    device_id: deviceId,
    expo_push_token: token,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  // The profile's push_tokens row holds the preferences (notify_*), so it must exist; its legacy
  // single token belongs to whichever device wrote it last, and would outlive that device's
  // sign-out: cleared. Only the token column is written, the preferences stay as they are.
  const { error: legacyError } = await cfg.supabase
    .from("push_tokens")
    .upsert({ user_id: uid, expo_push_token: null }, { onConflict: "user_id" });
  if (legacyError) throw legacyError;
}

/**
 * Delete this device's `push_devices` row from the current profile, so its pushes
 * stop reaching this device. No-op without an install id or a session; rejects on
 * a backend error.
 */
export async function unregisterPushDevice(cfg: ResolvedCommunityConfig): Promise<void> {
  const deviceId = cfg.host.getInstallId();
  if (!deviceId || !cfg.supabase) return;
  await adoptionSettled(); // the row of the session being applied, not of the one it replaces
  const uid = (await cfg.supabase.auth.getSession()).data.session?.user.id;
  if (!uid) return;
  const { error } = await cfg.supabase
    .from("push_devices")
    .delete()
    .eq("user_id", uid)
    .eq("device_id", deviceId);
  if (error) throw error;
}
