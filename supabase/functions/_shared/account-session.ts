// account-session logic: find, convert or create the account profile, merge the caller's own
// anonymous profile into it, and open its session. account_links is the only source of truth:
// an auth user is never adopted because it carries the account's synthetic email.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  AccountProofError,
  AccountProviderError,
  syntheticEmail,
  type VerifiedAccount,
} from "./accounts.ts";

export type AuthUser = { id: string; email?: string | null; is_anonymous?: boolean };
export type Session = { access_token: string; refresh_token: string };

/** An answer other than 200, with its `{ error }` code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
/** Another auth user already holds this email. */
export class EmailTakenError extends Error {}

export type AccountSessionDeps = {
  secret: string;
  db: {
    linkedProfile(provider: string, subject: string): Promise<string | null>;
    /** The given profiles that some account is linked to. */
    linkedAmong(ids: string[]): Promise<string[]>;
    /** Epoch ms of each profile's latest post, comment, like or creation. */
    lastActive(ids: string[]): Promise<Record<string, number>>;
    userIdByEmail(email: string): Promise<string | null>;
    /** Links and merges in one transaction; true when the link is new. Throws HttpError(409) on a link conflict. */
    linkAndMerge(
      provider: string,
      subject: string,
      main: string,
      merge: string[],
    ): Promise<boolean>;
    /** Resets the profile's identity, deletes its push rows and revokes every session, in one call. */
    deleteProfileData(profile: string): Promise<void>;
    unlink(provider: string, subject: string): Promise<void>;
    /** False when this account called less than 10 s ago. */
    touchRateLimit(subjectHash: string): Promise<boolean>;
  };
  authAdmin: {
    getUser(id: string): Promise<AuthUser | null>;
    updateUserById(id: string, attrs: { email: string; email_confirm: true }): Promise<void>;
    createUser(attrs: { email: string; email_confirm: true }): Promise<AuthUser>;
    deleteUser(id: string): Promise<void>;
  };
  openSession(email: string): Promise<Session>;
  /** Optional app SQL hooks. They may run more than once for the same link: they must be idempotent. */
  hooks: {
    /** null when the hook is not installed. */
    candidates(provider: string, subject: string, claims: unknown): Promise<string[] | null>;
    /** undefined when the hook is not installed, else its result (null for SQL NULL). */
    ownsProfile(profile: string, claims: unknown): Promise<boolean | null | undefined>;
    onLinked(profile: string, provider: string, subject: string, claims: unknown): Promise<void>;
  };
};

export async function resolveAccountSession(
  deps: AccountSessionDeps,
  { verified, callerId }: { verified: VerifiedAccount; callerId: string | null },
): Promise<Session & { profile_id: string; subject_hash: string }> {
  const { provider, subject, claims } = verified;
  const email = await syntheticEmail(deps.secret, provider, subject);
  const subjectHash = email.slice("account+".length, "account+".length + 32);
  if (!(await deps.db.touchRateLimit(subjectHash))) throw new HttpError(429, "rate_limited");

  // The caller's profile may be converted or merged only if it is anonymous and belongs to nobody else.
  const caller = callerId ? await deps.authAdmin.getUser(callerId) : null;
  // An installed account_owns_profile agrees only with true: NULL (e.g. a missing key) is a no.
  let callerFree = !!caller?.is_anonymous && (await deps.db.linkedAmong([caller.id])).length === 0;
  if (callerFree) {
    const owns = await deps.hooks.ownsProfile(caller!.id, claims);
    callerFree = owns === undefined || owns === true;
  }

  let main = await deps.db.linkedProfile(provider, subject);
  let merge: string[] = [];
  if (!main) {
    const candidates = [...new Set((await deps.hooks.candidates(provider, subject, claims)) ?? [])];
    const taken = candidates.length ? await deps.db.linkedAmong(candidates) : [];
    const unlinked = candidates.filter((id) => !taken.includes(id));
    const at = unlinked.length ? await deps.db.lastActive(unlinked) : {};
    // An id without a profile row (stale hook data) would make every merge raise.
    const free = unlinked.filter((id) => id in at);
    if (free.length) {
      main = free.reduce((a, b) => (at[b] > at[a] ? b : a));
      merge = free.filter((id) => id !== main);
    } else if (callerFree) {
      main = caller!.id;
    } else {
      const created = await replacingSquatter(deps, email, () =>
        deps.authAdmin.createUser({ email, email_confirm: true }),
      );
      main = created.id;
    }
  }
  if (callerFree && caller!.id !== main && !merge.includes(caller!.id)) merge.push(caller!.id);

  // Link first, then the email: a crash in between leaves a link whose email the next call sets.
  const isNew = await deps.db.linkAndMerge(provider, subject, main, merge);
  const emailMissing = (await deps.authAdmin.getUser(main))?.email !== email;
  if (emailMissing) {
    await replacingSquatter(deps, email, () =>
      deps.authAdmin.updateUserById(main!, { email, email_confirm: true }),
    );
  }
  // A missing email on a linked profile means an earlier call died before reaching the hook.
  if (isNew || emailMissing) {
    try {
      await deps.hooks.onLinked(main, provider, subject, claims);
    } catch (e) {
      // Not retried once the email is set: logged for the app to act on.
      console.error("account-session: on_account_linked failed", e);
    }
  }
  return { ...(await deps.openSession(email)), profile_id: main, subject_hash: subjectHash };
}

// Runs `op`; if the email is held by an unlinked user (a squatter: public sign-up on that address,
// or a user left by an interrupted call), deletes it and runs `op` once more.
async function replacingSquatter<T>(
  deps: AccountSessionDeps,
  email: string,
  op: () => Promise<T>,
): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (!(e instanceof EmailTakenError)) throw e;
  }
  const squatter = await deps.db.userIdByEmail(email);
  // Gone since (a concurrent call deleted it): just try again.
  if (!squatter) return op();
  if ((await deps.db.linkedAmong([squatter])).length) {
    console.error("account-session: the account's email is held by a linked user");
    throw new HttpError(409, "conflict");
  }
  console.warn("account-session: deleting an unlinked user that held the account's email");
  await deps.authAdmin.deleteUser(squatter);
  return op();
}

export async function accountSessionResponse(
  deps: AccountSessionDeps & { verify(proof: string): Promise<VerifiedAccount> },
  { proof, callerId }: { proof: string; callerId: string | null },
): Promise<{ status: number; body: unknown }> {
  try {
    const verified = await deps.verify(proof);
    return { status: 200, body: await resolveAccountSession(deps, { verified, callerId }) };
  } catch (e) {
    if (e instanceof AccountProofError) return { status: 401, body: { error: "bad_proof" } };
    if (e instanceof AccountProviderError) {
      console.error("account-session: provider unavailable", e.message);
      return { status: 503, body: { error: "provider_unavailable" } };
    }
    if (e instanceof HttpError) return { status: e.status, body: { error: e.code } };
    console.error("account-session failed", e);
    return { status: 500, body: { error: "internal" } };
  }
}

/** Deletes the account's data on the profile; false when no profile is linked. */
export async function deleteAccountProfile(
  deps: AccountSessionDeps,
  { provider, subject }: { provider: string; subject: string },
): Promise<boolean> {
  const profile = await deps.db.linkedProfile(provider, subject);
  if (!profile) return false;
  // Reset and revoke first, so a crash later leaves the profile already empty and signed out.
  await deps.db.deleteProfileData(profile);
  // Email before unlink: while the link exists a retry finds it and repeats these idempotent steps.
  // Unlinking first would strand the old email, and a later sign-in would delete the profile as a squatter.
  await deps.authAdmin.updateUserById(profile, {
    email: `${crypto.randomUUID()}@deleted.invalid`,
    email_confirm: true,
  });
  await deps.db.unlink(provider, subject);
  return true;
}

/** Reads an account-delete body: a proof, or a named account that only the service role may send. */
export function parseDeleteRequest(
  body: { proof?: unknown; provider?: unknown; subject?: unknown } | null,
  isService: boolean,
):
  | { input: { proof: string } | { service: { provider: string; subject: string } } }
  | { status: number; error: string } {
  const { proof, provider, subject } = body ?? {};
  if (typeof proof === "string" && proof) return { input: { proof } };
  if (typeof provider === "string" && typeof subject === "string" && provider && subject) {
    if (!isService) return { status: 401, error: "bad_proof" };
    return { input: { service: { provider, subject } } };
  }
  return { status: 400, error: "bad_request" };
}

export async function accountDeleteResponse(
  deps: AccountSessionDeps & { verify(proof: string): Promise<VerifiedAccount> },
  input: { proof: string } | { service: { provider: string; subject: string } },
): Promise<{ status: number; body: unknown }> {
  try {
    const account = "proof" in input ? await deps.verify(input.proof) : input.service;
    return { status: 200, body: { deleted: await deleteAccountProfile(deps, account) } };
  } catch (e) {
    if (e instanceof AccountProofError) return { status: 401, body: { error: "bad_proof" } };
    if (e instanceof AccountProviderError) {
      console.error("account-delete: provider unavailable", e.message);
      return { status: 503, body: { error: "provider_unavailable" } };
    }
    console.error("account-delete failed", e);
    return { status: 500, body: { error: "internal" } };
  }
}

/** Only account_link_and_merge's own conflicts; any other unique violation is a bug (500). */
export const isLinkConflict = (e: { code?: string; message: string }) =>
  e.code === "23505" &&
  (e.message.includes("account_links_profile_id_key") ||
    e.message.includes("the account is linked to another profile"));

const isEmailTaken = (e: { code?: string; message: string }) =>
  e.code === "email_exists" || /already (been )?registered/i.test(e.message);

/** The real dependencies: `admin` is the service-role client, `anon()` a fresh anon-key client. */
export function supabaseAccountDeps(
  admin: SupabaseClient,
  anon: () => SupabaseClient,
  secret: string,
): AccountSessionDeps {
  const must = <T>(r: { data: unknown; error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data as T;
  };
  const rpc = async <T>(fn: string, args: Record<string, unknown>) =>
    must<T>(await admin.rpc(fn, args), fn);
  const hookExists = (name: string) => rpc<boolean>("account_hook_exists", { name });

  return {
    secret,
    db: {
      linkedProfile: async (provider, subject) =>
        must<{ profile_id: string } | null>(
          await admin
            .from("account_links")
            .select("profile_id")
            .eq("provider", provider)
            .eq("subject", subject)
            .maybeSingle(),
          "account_links",
        )?.profile_id ?? null,
      linkedAmong: async (ids) =>
        must<{ profile_id: string }[]>(
          await admin.from("account_links").select("profile_id").in("profile_id", ids),
          "account_links",
        ).map((r) => r.profile_id),
      lastActive: async (ids) =>
        Object.fromEntries(
          (
            await rpc<{ profile_id: string; at: string }[]>("account_last_active", {
              p_profiles: ids,
            })
          ).map((r) => [r.profile_id, Date.parse(r.at)]),
        ),
      userIdByEmail: (email) => rpc<string | null>("account_user_id_by_email", { p_email: email }),
      linkAndMerge: async (provider, subject, main, merge) => {
        const { data, error } = await admin.rpc("account_link_and_merge", {
          p_provider: provider,
          p_subject: subject,
          p_main: main,
          p_merge: merge,
        });
        if (error && isLinkConflict(error)) {
          console.error("account-session: link conflict", error.message);
          throw new HttpError(409, "conflict");
        }
        if (error) throw new Error(`account_link_and_merge: ${error.message}`);
        return data as boolean;
      },
      deleteProfileData: async (profile) => {
        await rpc("account_delete_profile", { p_profile: profile });
      },
      unlink: async (provider, subject) => {
        must(
          await admin
            .from("account_links")
            .delete()
            .eq("provider", provider)
            .eq("subject", subject),
          "account_links",
        );
      },
      touchRateLimit: async (subjectHash) =>
        (await rpc<boolean | null>("account_session_touch", { p_subject_hash: subjectHash })) ===
        true,
    },
    authAdmin: {
      getUser: async (id) => {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error && error.status !== 404) throw new Error(`getUserById: ${error.message}`);
        return data.user ?? null;
      },
      updateUserById: async (id, attrs) => {
        const { error } = await admin.auth.admin.updateUserById(id, attrs);
        if (error && isEmailTaken(error)) throw new EmailTakenError(error.message);
        if (error) throw new Error(`updateUserById: ${error.message}`);
      },
      createUser: async (attrs) => {
        const { data, error } = await admin.auth.admin.createUser(attrs);
        if (error && isEmailTaken(error)) throw new EmailTakenError(error.message);
        if (error) throw new Error(`createUser: ${error.message}`);
        return data.user;
      },
      deleteUser: async (id) => {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw new Error(`deleteUser: ${error.message}`);
      },
    },
    openSession: async (email) => {
      const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (error) throw new Error(`generateLink: ${error.message}`);
      // A separate client: verifying on `admin` would swap its service role for the user's session.
      const { data: s, error: e2 } = await anon().auth.verifyOtp({
        token_hash: data.properties.hashed_token,
        type: "magiclink",
      });
      if (e2 || !s.session) throw new Error(`verifyOtp: ${e2?.message ?? "no session"}`);
      return { access_token: s.session.access_token, refresh_token: s.session.refresh_token };
    },
    hooks: {
      candidates: async (provider, subject, claims) =>
        (await hookExists("account_profile_candidates"))
          ? rpc<string[]>("account_profile_candidates", { provider, subject, claims })
          : null,
      ownsProfile: async (profile, claims) =>
        (await hookExists("account_owns_profile"))
          ? rpc<boolean | null>("account_owns_profile", { profile, claims })
          : undefined,
      onLinked: async (profile, provider, subject, claims) => {
        if (await hookExists("on_account_linked"))
          await rpc("on_account_linked", { profile, provider, subject, claims });
      },
    },
  };
}
