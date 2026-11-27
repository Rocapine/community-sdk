import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveConfig, type CommunityConfig, type CommunityHostAdapters } from "../config";
import {
  accountSignedIn,
  accountSignedOut,
  deleteAccountProfile,
  ensureIdentity,
  resetIdentity,
} from "../identity";

const HASH_A = "a".repeat(32);
const HASH_B = "b".repeat(32);

type FakeSession = { access_token: string; user: { id: string; email?: string | null } };

const anonSession: FakeSession = { access_token: "anon-at", user: { id: "anon-uid", email: null } };
const accountSession = (hash: string, id = `${hash[0]}-uid`): FakeSession => ({
  access_token: `${hash[0]}-at`,
  user: { id, email: `account+${hash}@account.invalid` },
});

const opened = (hash: string) => ({
  access_token: `new-${hash[0]}-at`,
  refresh_token: `new-${hash[0]}-rt`,
  profile_id: `${hash[0]}-uid`,
  subject_hash: hash,
});

/** A functions.invoke error as supabase-js returns it: the Response in `context`. */
const httpError = (status: number, body?: unknown) => ({
  name: "FunctionsHttpError",
  context: {
    status,
    json: async () => {
      if (body === undefined) throw new Error("no JSON body");
      return body;
    },
  },
});

type Invoke = { name: string; body: unknown; headers?: Record<string, string> };
type InvokeAnswer = { data: unknown; error: unknown };

function fakeClient(start: FakeSession | null, answer: (call: Invoke) => InvokeAnswer) {
  const log: string[] = [];
  const invokes: Invoke[] = [];
  const setSessions: unknown[] = [];
  const signOuts: unknown[] = [];
  let signIns = 0;
  let session = start;
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      setSession: async (tokens: { access_token: string; refresh_token: string }) => {
        log.push("setSession");
        setSessions.push(tokens);
        // "new-b-at" → the account session of HASH_B.
        session = accountSession(tokens.access_token[4].repeat(32));
        return { data: {}, error: null };
      },
      signOut: async (opts: unknown) => {
        log.push("signOut");
        signOuts.push(opts);
        session = null;
        return { error: null };
      },
      signInAnonymously: async () => {
        signIns += 1;
        return { data: { user: { id: "fresh-anon-uid" } }, error: null };
      },
    },
    functions: {
      invoke: async (name: string, opts: { body: unknown; headers?: Record<string, string> }) => {
        const call = { name, body: opts.body, headers: opts.headers };
        invokes.push(call);
        return answer(call);
      },
    },
    from: (table: string) => ({
      delete: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: async (c2: string, v2: unknown) => {
            log.push(`delete ${table} ${c1}=${v1} ${c2}=${v2}`);
            return { error: null };
          },
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
    rpc: async () => ({ error: null }),
  } as unknown as SupabaseClient;
  return { client, log, invokes, setSessions, signOuts, signIns: () => signIns };
}

const config = (
  supabase: SupabaseClient,
  host: CommunityHostAdapters,
  extra: Partial<CommunityConfig> = {},
): CommunityConfig => ({
  supabase,
  appName: "Test App",
  topics: [{ id: "general" }],
  modules: { polls: false, push: true, inbox: false, reaction: false as const },
  ...extra,
  host: { getLocale: () => "en", getInstallId: () => "install-1", ...host },
});

const proof = { provider: "test", token: "proof-token" };
const noCall = (): InvokeAnswer => {
  throw new Error("account-session must not be called");
};

describe("ensureIdentity with account proofs", () => {
  beforeEach(() => {
    resetIdentity();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a stored anonymous session without asking for a proof", async () => {
    const getAccountProof = vi.fn(async () => proof);
    const f = fakeClient(anonSession, noCall);
    expect(await ensureIdentity(resolveConfig(config(f.client, { getAccountProof })))).toBe(
      "anon-uid",
    );
    expect(getAccountProof).not.toHaveBeenCalled();
    expect(f.invokes).toHaveLength(0);
  });

  it("account session without proof signs out, then signs in anonymously", async () => {
    const f = fakeClient(accountSession(HASH_A), noCall);
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => null }));
    expect(await ensureIdentity(cfg)).toBe("fresh-anon-uid");
    expect(f.log).toEqual(["delete push_devices user_id=a-uid device_id=install-1", "signOut"]);
    expect(f.signOuts).toEqual([{ scope: "local" }]);
    expect(f.signIns()).toBe(1);
  });

  it("account session without proof and accounts required stays signed out", async () => {
    const f = fakeClient(accountSession(HASH_A), noCall);
    const cfg = resolveConfig(
      config(f.client, { getAccountProof: async () => null }, { accounts: { required: true } }),
    );
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(f.signOuts).toHaveLength(1);
    expect(f.signIns()).toBe(0);
  });

  it("different account switches to the returned session", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({ data: opened(HASH_B), error: null }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await ensureIdentity(cfg)).toBe("b-uid");
    expect(f.invokes).toEqual([
      {
        name: "account-session",
        body: { proof: "proof-token" },
        headers: { Authorization: "Bearer a-at" },
      },
    ]);
    expect(f.setSessions).toEqual([{ access_token: "new-b-at", refresh_token: "new-b-rt" }]);
    // The old account's push row goes first: its pushes must stop reaching this device.
    expect(f.log).toEqual(["delete push_devices user_id=a-uid device_id=install-1", "setSession"]);
  });

  it("same account keeps the session and checks once per launch", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({ data: opened(HASH_A), error: null }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.setSessions).toHaveLength(0);
    expect(f.invokes).toHaveLength(1);
  });

  it("relaunch: a confirmation without tokens keeps the stored session, nothing minted", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({
      data: { profile_id: "a-uid", subject_hash: HASH_A },
      error: null,
    }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.setSessions).toHaveLength(0);
    expect(f.invokes).toHaveLength(1);
  });

  it("a tokenless answer for another account is a failure: the session is kept, retried later", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({
      data: { profile_id: "b-uid", subject_hash: HASH_B },
      error: null,
    }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.setSessions).toHaveLength(0);
    expect(f.signOuts).toHaveLength(0);
    expect(f.invokes).toHaveLength(1); // the backoff holds the next check
  });

  it("provider failure keeps the stored account session", async () => {
    const f = fakeClient(accountSession(HASH_A), noCall);
    const cfg = resolveConfig(
      config(f.client, {
        getAccountProof: async () => {
          throw new Error("provider offline");
        },
      }),
    );
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.signOuts).toHaveLength(0);
    expect(f.signIns()).toBe(0);
  });

  it.each([
    ["503", httpError(503, { error: "provider_unavailable" })],
    ["429", httpError(429, { error: "rate_limited" })],
    ["409", httpError(409, { error: "conflict" })],
    ["500", httpError(500, { error: "internal" })],
    ["a gateway 401 without bad_proof", httpError(401, { msg: "Invalid JWT" })],
    ["a network error", { name: "FunctionsFetchError", context: new Error("offline") }],
  ])("%s keeps the stored session and retries on a later call", async (_label, error) => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const f = fakeClient(accountSession(HASH_A), () => ({ data: null, error }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.invokes).toHaveLength(1);
    now += 5 * 60_000;
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.invokes).toHaveLength(2);
    expect(f.signOuts).toHaveLength(0);
    expect(f.setSessions).toHaveLength(0);
    expect(f.signIns()).toBe(0);
  });

  it("a bad_proof answer keeps the stored session for this launch", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const f = fakeClient(accountSession(HASH_A), () => ({
      data: null,
      error: httpError(401, { error: "bad_proof" }),
    }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    now += 60 * 60_000;
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.invokes).toHaveLength(1);
    expect(f.signOuts).toHaveLength(0);
  });

  it("no session and a proof opens the account profile", async () => {
    const f = fakeClient(null, () => ({ data: opened(HASH_B), error: null }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await ensureIdentity(cfg)).toBe("b-uid");
    expect(f.invokes).toEqual([
      { name: "account-session", body: { proof: "proof-token" }, headers: undefined },
    ]);
    expect(f.setSessions).toEqual([{ access_token: "new-b-at", refresh_token: "new-b-rt" }]);
    expect(f.signIns()).toBe(0);
  });

  it("no session and a failing account-session returns null, then retries after a backoff", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const f = fakeClient(null, () => ({ data: null, error: httpError(503) }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(f.invokes).toHaveLength(1);
    now += 5 * 60_000;
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(f.invokes).toHaveLength(2);
    expect(f.signIns()).toBe(0);
  });

  it("no session and a throwing proof returns null without signing in, with a backoff", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const getAccountProof = vi.fn(async () => {
      throw new Error("provider offline");
    });
    const f = fakeClient(null, noCall);
    const cfg = resolveConfig(config(f.client, { getAccountProof }));
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(getAccountProof).toHaveBeenCalledTimes(1);
    now += 5 * 60_000;
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(getAccountProof).toHaveBeenCalledTimes(2);
    expect(f.signIns()).toBe(0);
  });

  it("a failing setSession during a switch never answers the old account's id", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({ data: opened(HASH_B), error: null }));
    (f.client.auth as unknown as { setSession: () => unknown }).setSession = async () => ({
      data: {},
      error: new Error("storage unavailable"),
    });
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await ensureIdentity(cfg)).toBeNull();
  });

  it("required: a stored anonymous session is signed out when the host is signed out", async () => {
    const f = fakeClient(anonSession, noCall);
    const cfg = resolveConfig(
      config(f.client, { getAccountProof: async () => null }, { accounts: { required: true } }),
    );
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(f.signOuts).toEqual([{ scope: "local" }]);
    expect(f.signIns()).toBe(0);
  });

  it("required: a stored anonymous session is kept while the host has a proof", async () => {
    const f = fakeClient(anonSession, noCall);
    const cfg = resolveConfig(
      config(f.client, { getAccountProof: async () => proof }, { accounts: { required: true } }),
    );
    expect(await ensureIdentity(cfg)).toBe("anon-uid");
    expect(f.signOuts).toHaveLength(0);
  });

  it("no session and no proof signs in anonymously", async () => {
    const f = fakeClient(null, noCall);
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => null }));
    expect(await ensureIdentity(cfg)).toBe("fresh-anon-uid");
    expect(f.signIns()).toBe(1);
  });

  it("required without proof returns null and never signs in anonymously", async () => {
    const f = fakeClient(null, noCall);
    const cfg = resolveConfig(
      config(f.client, { getAccountProof: async () => null }, { accounts: { required: true } }),
    );
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(f.signIns()).toBe(0);
  });
});

describe("account transitions", () => {
  beforeEach(() => {
    resetIdentity();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accountSignedIn converts the anonymous session", async () => {
    const f = fakeClient(anonSession, () => ({ data: opened(HASH_A), error: null }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    await accountSignedIn(cfg);
    expect(f.invokes).toEqual([
      {
        name: "account-session",
        body: { proof: "proof-token" },
        headers: { Authorization: "Bearer anon-at" },
      },
    ]);
    expect(f.setSessions).toEqual([{ access_token: "new-a-at", refresh_token: "new-a-rt" }]);
    // The anonymous profile is merged server-side: its push row is not deleted here.
    expect(f.log).toEqual(["setSession"]);
  });

  it("after accountSignedIn, ensureIdentity uses the new session without a second check", async () => {
    const f = fakeClient(anonSession, () => ({ data: opened(HASH_A), error: null }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    await accountSignedIn(cfg);
    (f.client.auth as unknown as { getSession: () => unknown }).getSession = async () => ({
      data: { session: accountSession(HASH_A) },
      error: null,
    });
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.invokes).toHaveLength(1);
  });

  it("accountSignedIn on the same account keeps the session and caches the check", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({ data: opened(HASH_A), error: null }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    await accountSignedIn(cfg);
    expect(f.setSessions).toHaveLength(0);
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.invokes).toHaveLength(1);
  });

  it("accountSignedIn is a no-op on the account this launch already checked", async () => {
    const getAccountProof = vi.fn(async () => proof);
    const f = fakeClient(accountSession(HASH_A), () => ({
      data: { profile_id: "a-uid", subject_hash: HASH_A },
      error: null,
    }));
    const cfg = resolveConfig(config(f.client, { getAccountProof }));
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    await accountSignedIn(cfg);
    expect(getAccountProof).toHaveBeenCalledTimes(1);
    expect(f.invokes).toHaveLength(1);
    expect(f.setSessions).toHaveLength(0);
  });

  it("accountSignedIn accepts a tokenless confirmation of the stored account", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({
      data: { profile_id: "a-uid", subject_hash: HASH_A },
      error: null,
    }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    await accountSignedIn(cfg);
    expect(f.setSessions).toHaveLength(0);
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.invokes).toHaveLength(1);
  });

  it("accountSignedIn rejects a tokenless answer for another account", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({
      data: { profile_id: "b-uid", subject_hash: HASH_B },
      error: null,
    }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    await expect(accountSignedIn(cfg)).rejects.toThrow();
    expect(f.setSessions).toHaveLength(0);
  });

  it("accountSignedIn rejects and keeps the anonymous session when account-session fails", async () => {
    const f = fakeClient(anonSession, () => ({ data: null, error: httpError(503) }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    await expect(accountSignedIn(cfg)).rejects.toThrow();
    expect(f.setSessions).toHaveLength(0);
    expect(f.signOuts).toHaveLength(0);
  });

  it("accountSignedOut deletes the push row, then signs out locally", async () => {
    const f = fakeClient(accountSession(HASH_A), noCall);
    await accountSignedOut(resolveConfig(config(f.client, {})));
    expect(f.log).toEqual(["delete push_devices user_id=a-uid device_id=install-1", "signOut"]);
    expect(f.signOuts).toEqual([{ scope: "local" }]);
  });

  it("accountSignedOut skips the push row without an install id and never throws", async () => {
    const f = fakeClient(accountSession(HASH_A), noCall);
    (f.client.auth as unknown as { signOut: () => Promise<never> }).signOut = async () => {
      throw new Error("storage unavailable");
    };
    await expect(
      accountSignedOut(resolveConfig(config(f.client, { getInstallId: () => null }))),
    ).resolves.toBeUndefined();
    expect(f.log).toEqual([]);
  });

  it("deleteAccountProfile invokes account-delete, then signs out locally", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({ data: { deleted: true }, error: null }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await deleteAccountProfile(cfg)).toBe(true);
    expect(f.invokes.map(({ name, body }) => ({ name, body }))).toEqual([
      { name: "account-delete", body: { proof: "proof-token" } },
    ]);
    expect(f.signOuts).toEqual([{ scope: "local" }]);
  });

  it("deleteAccountProfile returns false when the proof throws", async () => {
    const f = fakeClient(accountSession(HASH_A), noCall);
    const cfg = resolveConfig(
      config(f.client, {
        getAccountProof: async () => {
          throw new Error("provider offline");
        },
      }),
    );
    expect(await deleteAccountProfile(cfg)).toBe(false);
    expect(f.invokes).toHaveLength(0);
    expect(f.signOuts).toHaveLength(0);
  });

  it("deleteAccountProfile returns false and keeps the session when account-delete fails", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({ data: null, error: httpError(503) }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await deleteAccountProfile(cfg)).toBe(false);
    expect(f.signOuts).toHaveLength(0);
  });
});

describe("host transitions during a running account check", () => {
  beforeEach(() => {
    resetIdentity();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** account-session answers: the first call waits for `release`, the others answer at once. */
  function deferredFirst(first: InvokeAnswer, later: InvokeAnswer) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const answer = (async () => {
      calls += 1;
      if (calls === 1) {
        await gate;
        return first;
      }
      return later;
    }) as unknown as (call: Invoke) => InvokeAnswer;
    return { answer, release };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("a sign-out during the check wins: the late session is not applied", async () => {
    const d = deferredFirst({ data: opened(HASH_A), error: null }, { data: null, error: null });
    const f = fakeClient(null, d.answer);
    let signedIn = true;
    const cfg = resolveConfig(
      config(f.client, { getAccountProof: async () => (signedIn ? proof : null) }),
    );
    const pending = ensureIdentity(cfg);
    await flush();
    signedIn = false;
    await accountSignedOut(cfg);
    d.release();
    expect(await pending).toBeNull();
    expect(f.setSessions).toHaveLength(0);
    expect(await ensureIdentity(cfg)).toBe("fresh-anon-uid");
  });

  it("a sign-in to another account during the check wins: the device ends on it", async () => {
    const d = deferredFirst(
      { data: opened(HASH_A), error: null },
      { data: opened(HASH_B), error: null },
    );
    const f = fakeClient(null, d.answer);
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    const pending = ensureIdentity(cfg);
    await flush();
    const signingIn = accountSignedIn(cfg);
    await flush();
    d.release();
    await signingIn;
    // The check finishes first, then the sign-in switches from its session to the new account.
    expect(await pending).toBe("a-uid");
    expect(f.setSessions).toEqual([
      { access_token: "new-a-at", refresh_token: "new-a-rt" },
      { access_token: "new-b-at", refresh_token: "new-b-rt" },
    ]);
    expect(f.invokes[1].headers).toEqual({ Authorization: "Bearer a-at" });
    expect(await ensureIdentity(cfg)).toBe("b-uid");
    expect(f.invokes).toHaveLength(2);
  });

  it("a sign-in during a check opening the same account waits for it: nothing minted twice", async () => {
    const d = deferredFirst(
      { data: opened(HASH_A), error: null },
      { data: { profile_id: "a-uid", subject_hash: HASH_A }, error: null },
    );
    const f = fakeClient(null, d.answer);
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    const pending = ensureIdentity(cfg);
    await flush();
    const signingIn = accountSignedIn(cfg);
    await flush();
    expect(f.invokes).toHaveLength(1); // no second call while the first one runs
    d.release();
    await signingIn;
    expect(await pending).toBe("a-uid");
    // The second call carries the session the check opened: account-session confirms it,
    // before its rate limit, and mints nothing.
    expect(f.invokes[1].headers).toEqual({ Authorization: "Bearer a-at" });
    expect(f.setSessions).toEqual([{ access_token: "new-a-at", refresh_token: "new-a-rt" }]);
    expect(await ensureIdentity(cfg)).toBe("a-uid");
    expect(f.invokes).toHaveLength(2);
  });

  it("an ensureIdentity during accountSignedIn waits for it instead of calling account-session", async () => {
    const d = deferredFirst({ data: opened(HASH_A), error: null }, { data: null, error: null });
    const f = fakeClient(null, d.answer);
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    const signingIn = accountSignedIn(cfg);
    await flush();
    const pending = ensureIdentity(cfg);
    await flush();
    expect(f.invokes).toHaveLength(1);
    d.release();
    await signingIn;
    expect(await pending).toBe("a-uid");
    expect(f.invokes).toHaveLength(1);
    expect(f.setSessions).toEqual([{ access_token: "new-a-at", refresh_token: "new-a-rt" }]);
  });

  it("an ensureIdentity during a failed accountSignedIn still resolves", async () => {
    const d = deferredFirst(
      { data: null, error: httpError(503) },
      { data: null, error: httpError(503) },
    );
    const f = fakeClient(null, d.answer);
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    const signingIn = accountSignedIn(cfg);
    await flush();
    const pending = ensureIdentity(cfg);
    d.release();
    await expect(signingIn).rejects.toThrow();
    expect(await pending).toBeNull();
  });

  it("a sign-in while the check signs in anonymously converts that anonymous profile", async () => {
    let signedIn = false;
    const f = fakeClient(null, () => ({ data: opened(HASH_A), error: null }));
    const auth = f.client.auth as unknown as {
      getSession: () => Promise<unknown>;
      signInAnonymously: () => Promise<unknown>;
    };
    let session: FakeSession | null = null;
    auth.getSession = async () => ({ data: { session }, error: null });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    auth.signInAnonymously = async () => {
      await gate;
      session = { access_token: "fresh-anon-at", user: { id: "fresh-anon-uid", email: null } };
      return { data: { user: session.user }, error: null };
    };
    const cfg = resolveConfig(
      config(f.client, { getAccountProof: async () => (signedIn ? proof : null) }),
    );
    const pending = ensureIdentity(cfg);
    await flush();
    signedIn = true;
    const signingIn = accountSignedIn(cfg);
    await flush();
    release();
    await signingIn;
    expect(await pending).toBe("fresh-anon-uid");
    // Its anonymous session is the bearer: account-session merges that profile, none is left behind.
    expect(f.invokes).toHaveLength(1);
    expect(f.invokes[0].headers).toEqual({ Authorization: "Bearer fresh-anon-at" });
  });

  /** Holds the first setSession until `release`; later ones run at once. */
  function holdFirstSetSession(client: SupabaseClient) {
    const auth = client.auth as unknown as { setSession: (t: unknown) => Promise<unknown> };
    const original = auth.setSession;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    auth.setSession = async (tokens) => {
      calls += 1;
      if (calls === 1) await gate;
      return original(tokens);
    };
    return () => release();
  }

  it("a sign-out while the session is being applied ends signed out", async () => {
    let signedIn = true;
    const getAccountProof = vi.fn(async () => (signedIn ? proof : null));
    const f = fakeClient(null, () => ({ data: opened(HASH_A), error: null }));
    const release = holdFirstSetSession(f.client);
    const cfg = resolveConfig(config(f.client, { getAccountProof }));
    const pending = ensureIdentity(cfg);
    await flush();
    expect(f.setSessions).toHaveLength(0); // setSession(A) is in flight
    signedIn = false;
    const signingOut = accountSignedOut(cfg);
    await flush();
    release();
    await signingOut;
    expect(await pending).toBeNull();
    expect(f.log).toEqual([
      "setSession",
      "delete push_devices user_id=a-uid device_id=install-1",
      "signOut",
    ]);
    const proofCalls = getAccountProof.mock.calls.length;
    // No cached check for A: the next call reads the (empty) session and asks for a proof.
    expect(await ensureIdentity(cfg)).toBe("fresh-anon-uid");
    expect(getAccountProof.mock.calls.length).toBe(proofCalls + 1);
  });

  it("a sign-in to another account while the session is being applied ends on it", async () => {
    let calls = 0;
    const f = fakeClient(null, () => {
      calls += 1;
      return { data: opened(calls === 1 ? HASH_A : HASH_B), error: null };
    });
    const release = holdFirstSetSession(f.client);
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    const pending = ensureIdentity(cfg);
    await flush();
    const signingIn = accountSignedIn(cfg);
    await flush();
    release();
    await signingIn;
    // The check lands first (its answer was right when it started), then the sign-in switches.
    expect(await pending).toBe("a-uid");
    expect(f.setSessions).toEqual([
      { access_token: "new-a-at", refresh_token: "new-a-rt" },
      { access_token: "new-b-at", refresh_token: "new-b-rt" },
    ]);
    expect(await ensureIdentity(cfg)).toBe("b-uid");
    expect(f.invokes).toHaveLength(2);
  });

  it("a check that never settles holds a sign-in for 15 s at most, then the sign-in wins", async () => {
    const f = fakeClient(null, ((call: Invoke) =>
      f.invokes.length === 1
        ? new Promise(() => {}) // the check's call never answers
        : { data: opened(HASH_B), error: null }) as unknown as (call: Invoke) => InvokeAnswer);
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    const pending = ensureIdentity(cfg);
    await flush();
    vi.useFakeTimers();
    try {
      const signingIn = accountSignedIn(cfg);
      await vi.advanceTimersByTimeAsync(15_000);
      await signingIn;
    } finally {
      vi.useRealTimers();
    }
    expect(f.setSessions).toEqual([{ access_token: "new-b-at", refresh_token: "new-b-rt" }]);
    expect(await ensureIdentity(cfg)).toBe("b-uid");
    void pending;
  });

  it("a setSession that never settles holds a sign-out for 5 s at most", async () => {
    const f = fakeClient(null, () => ({ data: opened(HASH_A), error: null }));
    holdFirstSetSession(f.client); // never released
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    void ensureIdentity(cfg);
    await flush();
    vi.useFakeTimers();
    try {
      const signingOut = accountSignedOut(cfg);
      await vi.advanceTimersByTimeAsync(5_000);
      await signingOut;
    } finally {
      vi.useRealTimers();
    }
    expect(f.signOuts).toEqual([{ scope: "local" }]);
  });
});
