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

  it("no session and a failing account-session returns null, then retries", async () => {
    const f = fakeClient(null, () => ({ data: null, error: httpError(503) }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(f.invokes).toHaveLength(2);
    expect(f.signIns()).toBe(0);
  });

  it("no session and a throwing proof returns null without signing in", async () => {
    const f = fakeClient(null, noCall);
    const cfg = resolveConfig(
      config(f.client, {
        getAccountProof: async () => {
          throw new Error("provider offline");
        },
      }),
    );
    expect(await ensureIdentity(cfg)).toBeNull();
    expect(f.signIns()).toBe(0);
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

  it("deleteAccountProfile returns false and keeps the session when account-delete fails", async () => {
    const f = fakeClient(accountSession(HASH_A), () => ({ data: null, error: httpError(503) }));
    const cfg = resolveConfig(config(f.client, { getAccountProof: async () => proof }));
    expect(await deleteAccountProfile(cfg)).toBe(false);
    expect(f.signOuts).toHaveLength(0);
  });
});
