import { presenceSettings, type ResolvedCommunityConfig } from "./config";
import { ensureIdentity } from "./identity";

export const PRESENCE_HEARTBEAT_MS = 60_000;

/** React Native's `AppState` shape; core does not import `react-native`. */
export type AppStateLike = {
  currentState?: string | null;
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
};

async function requireUid(cfg: ResolvedCommunityConfig): Promise<string> {
  const uid = await ensureIdentity(cfg);
  if (!uid) throw new Error("You appear to be offline. Please try again.");
  return uid;
}

/**
 * One heartbeat. Never rejects, and never signs in: without a session (or
 * client, or module) it does nothing, so a member who never posted stays invisible.
 */
export async function touchPresence(cfg: ResolvedCommunityConfig): Promise<void> {
  try {
    if (!presenceSettings(cfg) || !cfg.supabase) return;
    const client = cfg.requireClient();
    const { data } = await client.auth.getSession();
    if (!data.session) return;
    await client.rpc("touch_presence");
  } catch {
    // Offline or older backend: the next beat retries.
  }
}

/**
 * Beats while the app is in the foreground ("active"), once more when it goes
 * to the background. Returns the stop function.
 */
export function startPresenceHeartbeat(
  cfg: ResolvedCommunityConfig,
  appState: AppStateLike,
  intervalMs = PRESENCE_HEARTBEAT_MS,
): () => void {
  if (!presenceSettings(cfg)) return () => {};
  let timer: ReturnType<typeof setInterval> | null = null;
  let active = appState.currentState === "active";
  const beat = () => void touchPresence(cfg);
  const startTimer = () => {
    timer ??= setInterval(beat, intervalMs);
  };
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  if (active) {
    beat();
    startTimer();
  }
  const sub = appState.addEventListener("change", (state) => {
    const next = state === "active";
    if (next === active) return;
    active = next;
    if (next) {
      beat();
      startTimer();
    } else {
      stopTimer();
      beat();
    }
  });
  return () => {
    stopTimer();
    sub.remove();
  };
}

/** Members online right now. Throws on RPC error. */
export async function fetchOnlineCount(cfg: ResolvedCommunityConfig): Promise<number> {
  const { data, error } = await cfg.requireClient().rpc("online_member_count");
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/** The subset of `ids` that is online right now. Throws on RPC error. */
export async function fetchOnlineIds(
  cfg: ResolvedCommunityConfig,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await cfg.requireClient().rpc("online_member_ids", { p_ids: ids });
  if (error) throw error;
  return (data as string[] | null) ?? [];
}

/**
 * Coalesces single-id lookups made within `windowMs` into deduped batches of at
 * most `chunkSize`. A failed batch resolves its ids to false (offline).
 */
export function createOnlineBatcher(
  fetch: (ids: string[]) => Promise<string[]>,
  windowMs = 30,
  chunkSize = 200,
): (id: string) => Promise<boolean> {
  let pending = new Map<string, Array<(online: boolean) => void>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const batch = pending;
    pending = new Map();
    const ids = [...batch.keys()];
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      fetch(chunk).then(
        (online) => {
          const set = new Set(online);
          for (const id of chunk) batch.get(id)!.forEach((r) => r(set.has(id)));
        },
        () => {
          for (const id of chunk) batch.get(id)!.forEach((r) => r(false));
        },
      );
    }
  };

  return (id) =>
    new Promise<boolean>((resolve) => {
      const waiters = pending.get(id);
      if (waiters) waiters.push(resolve);
      else pending.set(id, [resolve]);
      timer ??= setTimeout(flush, windowMs);
    });
}

/** Whether this member shows as online to others; no row yet reads as true. */
export async function fetchMyPresenceVisible(cfg: ResolvedCommunityConfig): Promise<boolean> {
  const uid = await requireUid(cfg);
  const { data, error } = await cfg
    .requireClient()
    .from("member_presence")
    .select("visible")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return (data as { visible: boolean } | null)?.visible ?? true;
}

export async function setPresenceVisible(
  cfg: ResolvedCommunityConfig,
  visible: boolean,
): Promise<void> {
  await requireUid(cfg);
  const { error } = await cfg.requireClient().rpc("set_presence_visible", { p_visible: visible });
  if (error) throw error;
}
