import type { Session } from "@supabase/supabase-js";
import type { AccountProof, ResolvedCommunityConfig } from "./config";
import { unregisterPushDevice } from "./push-devices";
import { clearSignedUrls } from "./signed-urls";

// One anonymous Supabase identity per install. signInAnonymously() runs once;
// afterwards getSession() restores the same user (and uuid) from AsyncStorage.
// Ported from the mold's lib/community-identity.ts — see the design spec for
// what changed crossing the host-adapter seam.

let inFlight: Promise<string | null> | null = null;
let lastSyncedUsername: string | null = null;
let lastSyncedLocale: string | null = null;
let lastSyncedAnalyticsKey: string | null = null;
let lastSyncedBadgesKey: string | null = null;
// Accounts: the stored account session checked against the host's account this launch.
let accountCheck: { subjectHash: string; checkedAt: number } | null = null;
// When an account check that failed for a transient reason may run again (0: none pending).
let retryAfter = 0;
const RETRY_MS = 60_000;
// Bumped by every host transition: a bootstrap started before one never applies its result.
let epoch = 0;
// The setSession being applied: auth-js does not serialize it with signOut, so transitions await it.
let adopting: Promise<unknown> | null = null;
// The running accountSignedIn(): ensureIdentity() waits for it rather than calling account-session
// beside it (answered 429, or a second profile session minted for nothing).
let signingIn: Promise<void> | null = null;
// How long accountSignedIn() waits for a bootstrap already running before overriding it.
const BOOTSTRAP_WAIT_MS = 15_000;

function assertCurrent(start: number): void {
  if (epoch !== start) throw new Error("identity changed during the account check");
}

// A setSession that outlived its 5 s wait: later waits don't wait for it again.
let gaveUpOn: Promise<unknown> | null = null;

/** Waits for a setSession being applied, at most 5 s: a hung one must not block a transition, and
 * the epoch check after it already stops it from writing a stale cache. */
export async function adoptionSettled(): Promise<void> {
  const pending = adopting;
  if (!pending || pending === gaveUpOn) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    pending.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((r) => (timer = setTimeout(() => r(false), 5_000))),
  ]);
  clearTimeout(timer);
  if (!settled) gaveUpOn = pending;
}

/** Waits for `p` to settle, at most `ms`. */
async function settledWithin(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    p.catch(() => undefined),
    new Promise<void>((r) => (timer = setTimeout(r, ms))),
  ]);
  clearTimeout(timer);
}

/**
 * Resolve the community user id, signing in anonymously on first use.
 * Never rejects: resolves to null when offline, when anonymous sign-ins are
 * off, when the host never configured a Supabase client (degraded mode), or —
 * with `host.getAccountProof` — while no account session can be opened (or none
 * may be, `accounts.required` without a proof). The next call retries.
 */
export function ensureIdentity(cfg: ResolvedCommunityConfig): Promise<string | null> {
  if (!cfg.supabase) return Promise.resolve(null);
  if (signingIn) {
    const again = () => ensureIdentity(cfg);
    return signingIn.then(again, again);
  }
  if (retryAfter && Date.now() >= retryAfter) {
    retryAfter = 0;
    inFlight = null; // re-run the account check that failed
  }
  if (inFlight) return inFlight;
  const start = epoch;
  const p: Promise<string | null> = bootstrap(cfg, start).then(
    (uid) => {
      // Accounts: a host transition happened meanwhile, so this id may be stale: retry.
      if (cfg.host.getAccountProof && epoch !== start) return null;
      // No identity yet: retry on the next call (after the backoff, if one is set).
      if (uid === null && !retryAfter && inFlight === p) inFlight = null;
      return uid;
    },
    () => {
      // Allow a retry on the next call (after the backoff, if one is set).
      if (inFlight === p && !retryAfter) inFlight = null;
      return null;
    },
  );
  inFlight = p;
  return p;
}

/**
 * Drops the memoized identity (and every dedupe memo) so the next
 * ensureIdentity() re-reads the (possibly different) session. Call after any
 * host auth transition: login/SSO replaces the anonymous uid, logout needs a
 * fresh anonymous identity.
 */
export function resetIdentity(): void {
  epoch += 1;
  clearSignedUrls(); // another member's signed URLs must never be served
  inFlight = null;
  accountCheck = null;
  retryAfter = 0;
  resetSyncMemos();
}

function resetSyncMemos(): void {
  lastSyncedUsername = null;
  lastSyncedLocale = null;
  lastSyncedAnalyticsKey = null;
  lastSyncedBadgesKey = null;
}

async function bootstrap(cfg: ResolvedCommunityConfig, start: number): Promise<string | null> {
  const client = cfg.requireClient();
  const { data, error: sessionError } = await client.auth.getSession();
  // { session: null, error } = the stored session could not be refreshed right now
  // (offline, a refresh failure cooldown, a discarded refresh) but may still be in
  // storage. Signing in would overwrite it with a new user: retry on the next call.
  // A dead session is cleared by auth-js, so the next call reads { null, null }.
  if (!data.session && sessionError) throw sessionError;
  if (cfg.host.getAccountProof) return accountBootstrap(cfg, data.session, start);
  if (data.session) {
    await assignDefaultProfile(cfg);
    return data.session.user.id;
  }
  return signInAnonymous(cfg);
}

async function signInAnonymous(cfg: ResolvedCommunityConfig): Promise<string> {
  const client = cfg.requireClient();
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

/** account-session's answer; no tokens when the bearer already is this account's session. */
type OpenedAccount = {
  access_token?: string;
  refresh_token?: string;
  profile_id: string;
  subject_hash: string;
};
type MintedAccount = OpenedAccount & { access_token: string; refresh_token: string };
const minted = (o: OpenedAccount): o is MintedAccount => typeof o.access_token === "string";

const warn = (message: string, detail?: unknown) =>
  console.warn(`[@rocapine/community-core] ${message}`, detail ?? "");

/** The subject hash of an account session (`account+<hash>@account.invalid`), else null. */
function accountHash(session: Session | null): string | null {
  return /^account\+(.+)@account\.invalid$/.exec(session?.user.email ?? "")?.[1] ?? null;
}

/**
 * The stored session checked against the host's account. Never lands on someone
 * else's profile, and a provider failure never replaces an account session with a
 * fresh anonymous one: it keeps the session and retries later.
 */
async function accountBootstrap(
  cfg: ResolvedCommunityConfig,
  stored: Session | null,
  start: number,
): Promise<string | null> {
  let session = stored;
  const hash = accountHash(session);
  const required = cfg.accounts?.required === true;
  // An anonymous session is kept (the host converts it with accountSignedIn()), unless
  // accounts are required and the host is signed out. A checked account session is kept.
  if (session && ((!hash && !required) || (hash && accountCheck?.subjectHash === hash))) {
    await assignDefaultProfile(cfg);
    return session.user.id;
  }

  let proof: AccountProof | null;
  try {
    proof = await cfg.host.getAccountProof!();
  } catch (e) {
    warn("no account proof right now, keeping the session", e);
    assertCurrent(start);
    retryAfter = Date.now() + RETRY_MS;
    return session?.user.id ?? null;
  }

  if (session && !hash) {
    // Accounts required: keep it only while the host is signed in.
    if (proof) {
      await assignDefaultProfile(cfg);
      return session.user.id;
    }
    assertCurrent(start);
    await signOutLocally(cfg);
    return null;
  }
  if (session && !proof) {
    assertCurrent(start);
    await signOutLocally(cfg); // the host signed out
    session = null;
  }
  if (!session) {
    if (!proof) {
      if (required) return null;
      assertCurrent(start);
      return signInAnonymous(cfg);
    }
    const opened = await callAccountSession(cfg, proof, null);
    if (typeof opened === "string" || !minted(opened)) {
      assertCurrent(start);
      retryAfter = Date.now() + RETRY_MS; // don't call the provider on every service call
      return null;
    }
    await adoptAccount(cfg, opened, null, start);
    await assignDefaultProfile(cfg);
    return opened.profile_id;
  }

  const opened = await callAccountSession(cfg, proof!, session);
  if (opened === "bad_proof") {
    // The provider refused a token the host believed valid (clock skew, glitch):
    // keep the account for this launch, sign out only when the host says so.
    warn("the account proof was refused, keeping the session for this launch");
    return session.user.id;
  }
  if (opened === "failed") {
    assertCurrent(start);
    retryAfter = Date.now() + RETRY_MS;
    return session.user.id;
  }
  if (opened.subject_hash !== hash) {
    if (!minted(opened)) {
      // Another account, but no session for it: never answer either profile as confirmed.
      warn("account-session answered another account without a session");
      assertCurrent(start);
      retryAfter = Date.now() + RETRY_MS;
      return session.user.id;
    }
    await adoptAccount(cfg, opened, session, start);
  }
  assertCurrent(start);
  accountCheck = { subjectHash: opened.subject_hash, checkedAt: Date.now() };
  await assignDefaultProfile(cfg);
  return opened.profile_id;
}

/** `account-session` with the proof and, when there is one, the device's session as bearer. */
async function callAccountSession(
  cfg: ResolvedCommunityConfig,
  proof: AccountProof,
  session: Session | null,
): Promise<OpenedAccount | "bad_proof" | "failed"> {
  try {
    const { data, error } = await cfg.requireClient().functions.invoke("account-session", {
      body: { proof: proof.token },
      headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    });
    if (!error) {
      const d = data as Partial<OpenedAccount> | null;
      const tokens = typeof d?.access_token === "string" && typeof d.refresh_token === "string";
      const none = d?.access_token === undefined && d?.refresh_token === undefined;
      if (
        (tokens || none) &&
        typeof d?.profile_id === "string" &&
        typeof d.subject_hash === "string"
      ) {
        return d as OpenedAccount;
      }
      warn("account-session answered something else than a session");
      return "failed";
    }
    // supabase-js puts the Response in `context`; a network error has no status.
    const res = (error as { context?: { status?: number; json?: () => Promise<unknown> } }).context;
    let code: unknown;
    try {
      code = ((await res?.json?.()) as { error?: unknown } | undefined)?.error;
    } catch {
      code = undefined;
    }
    // A gateway 401 (expired bearer) has no bad_proof body: transient, never a bad proof.
    if (res?.status === 401 && code === "bad_proof") return "bad_proof";
    warn(`account-session failed (${res?.status ?? "network"} ${code ?? ""})`);
    return "failed";
  } catch (e) {
    warn("account-session failed", e);
    return "failed";
  }
}

/** Switch the device to the account profile's session. Leaving another account
 * first deletes this device's push row there, so its pushes stop reaching it. */
async function adoptAccount(
  cfg: ResolvedCommunityConfig,
  opened: MintedAccount,
  previous: Session | null,
  start: number,
): Promise<void> {
  const client = cfg.requireClient();
  assertCurrent(start);
  if (accountHash(previous)) await unregisterQuietly(cfg);
  assertCurrent(start);
  const applying = client.auth.setSession({
    access_token: opened.access_token,
    refresh_token: opened.refresh_token,
  });
  adopting = applying;
  const { error } = await applying.finally(() => {
    if (adopting === applying) adopting = null;
  });
  if (error) {
    retryAfter = Date.now() + RETRY_MS; // don't retry the switch on every service call
    throw error;
  }
  assertCurrent(start); // a transition started while it applied: it owns the session now
  resetSyncMemos();
  accountCheck = { subjectHash: opened.subject_hash, checkedAt: Date.now() };
}

async function unregisterQuietly(cfg: ResolvedCommunityConfig): Promise<void> {
  try {
    await unregisterPushDevice(cfg);
  } catch (e) {
    warn("could not delete this device's push row", e);
  }
}

/** Push row, local sign-out, memos (not the in-flight bootstrap). Never throws. */
async function signOutLocally(cfg: ResolvedCommunityConfig): Promise<void> {
  await unregisterQuietly(cfg);
  try {
    const { error } = await cfg.requireClient().auth.signOut({ scope: "local" });
    if (error) warn("local sign-out failed", error);
  } catch (e) {
    warn("local sign-out failed", e);
  }
  resetSyncMemos();
  accountCheck = null;
}

/**
 * The host signed in: open the account profile's session. An anonymous session
 * is converted into it or merged into it server-side. Rejects (keeping the
 * current session) when the host has no proof or the backend refused or failed:
 * call it again later.
 */
export function accountSignedIn(cfg: ResolvedCommunityConfig): Promise<void> {
  const run: Promise<void> = openAccount(cfg).finally(() => {
    if (signingIn === run) signingIn = null;
  });
  signingIn = run;
  return run;
}

async function openAccount(cfg: ResolvedCommunityConfig): Promise<void> {
  const client = cfg.requireClient();
  // Already on the account session this launch checked: nothing to open (no call, no 429).
  // A switch to another account is accountSignedOut() first, which drops that check.
  const current = (await client.auth.getSession()).data.session;
  if (!adopting && accountCheck && accountHash(current) === accountCheck.subjectHash) return;
  // A bootstrap already running (opening the account, or signing in anonymously) lands first:
  // calling beside it is answered 429, and the session it then reads is the one to convert or
  // confirm, so no anonymous profile or minted session is left behind. Bounded: a hung one is
  // overridden below. It never rejects (ensureIdentity catches).
  if (inFlight) await settledWithin(inFlight, BOOTSTRAP_WAIT_MS);
  // Any bootstrap still running is stale from here on.
  const start = ++epoch;
  inFlight = null;
  clearSignedUrls();
  await adoptionSettled();
  const proof = await cfg.host.getAccountProof?.();
  if (!proof) throw new Error("accountSignedIn: the host gave no account proof");
  const { data, error } = await client.auth.getSession();
  // Calling without the stored session would leave its content behind.
  if (!data.session && error) throw error;
  const opened = await callAccountSession(cfg, proof, data.session);
  if (typeof opened === "string") throw new Error(`accountSignedIn: account-session ${opened}`);
  if (opened.subject_hash !== accountHash(data.session)) {
    if (!minted(opened)) throw new Error("accountSignedIn: account-session answered no session");
    await adoptAccount(cfg, opened, data.session, start);
  }
  assertCurrent(start);
  accountCheck = { subjectHash: opened.subject_hash, checkedAt: Date.now() };
  retryAfter = 0;
  epoch += 1; // a bootstrap started meanwhile may have read the old session
  inFlight = null;
}

/**
 * The host signed out: delete this device's push row, sign out locally and drop
 * the memos. The next ensureIdentity() opens a fresh anonymous profile (none when
 * `accounts.required`). Never throws. A switch A → B is accountSignedOut() then
 * accountSignedIn().
 */
export async function accountSignedOut(cfg: ResolvedCommunityConfig): Promise<void> {
  if (!cfg.supabase) return;
  resetIdentity(); // a running bootstrap must not apply its session over the sign-out
  await adoptionSettled(); // one already applying lands first, then is signed out
  await signOutLocally(cfg);
  resetIdentity();
}

/**
 * Account deletion: reset the account profile, revoke its sessions and unlink the
 * account (`account-delete`), then sign out like accountSignedOut(). Call it
 * before disabling the host account, while a proof can still be issued. Resolves
 * false (keeping the session) when there is no proof or the backend failed.
 */
export async function deleteAccountProfile(cfg: ResolvedCommunityConfig): Promise<boolean> {
  if (!cfg.supabase) return false;
  try {
    const proof = await cfg.host.getAccountProof?.();
    if (!proof) return false;
    const { error } = await cfg.supabase.functions.invoke("account-delete", {
      body: { proof: proof.token },
    });
    if (error) {
      warn("account-delete failed", error);
      return false;
    }
  } catch (e) {
    warn("account-delete failed", e);
    return false;
  }
  await accountSignedOut(cfg);
  return true;
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
  if (cfg.modules.badges) {
    const uid = (await cfg.supabase.auth.getSession()).data.session?.user.id;
    if (uid) {
      await cfg.supabase.from("profiles").update({ badges: {} }).eq("id", uid);
      lastSyncedBadgesKey = null;
    }
  }
  const { error } = await cfg.supabase.rpc("reset_profile_identity");
  return !error;
}

/**
 * Mirror the host's display name, locale, analytics ids and badges onto the
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
  const badges = cfg.modules.badges ? cfg.host.getBadges() : null;
  const badgesKey = badges ? JSON.stringify(badges) : null;
  if (badges && badgesKey !== lastSyncedBadgesKey) update.badges = badges;
  if (Object.keys(update).length === 0) return;

  const uid = await ensureIdentity(cfg);
  if (!uid) return;

  const client = cfg.requireClient();
  const { error } = await client.from("profiles").update(update).eq("id", uid);
  if (!error) {
    if ("username" in update) lastSyncedUsername = name;
    if ("locale" in update) lastSyncedLocale = locale;
    if ("amplitude_id" in update) lastSyncedAnalyticsKey = analyticsKey;
    if ("badges" in update) lastSyncedBadgesKey = badgesKey;
  }
}
