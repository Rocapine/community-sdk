import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { AccountProofError, AccountProviderError, syntheticEmail } from "./accounts.ts";
import {
  accountSessionResponse,
  EmailTakenError,
  HttpError,
  type AccountSessionDeps,
  type AuthUser,
} from "./account-session.ts";

const SECRET = "pepper";
const DAY = 86_400_000;

type World = {
  links: Map<string, string>; // "provider:subject" -> profile
  users: Map<string, AuthUser>;
  activity: Record<string, number>;
  candidates: string[] | null; // null: hook not installed
  owns: boolean | null; // null: hook not installed
  calls: string[];
  merges: [string, string][];
  linkedHook: number;
  rate: Map<string, number>;
};

const world = (w: Partial<World> = {}): World => ({
  links: new Map(),
  users: new Map(),
  activity: {},
  candidates: null,
  owns: null,
  calls: [],
  merges: [],
  linkedHook: 0,
  rate: new Map(),
  ...w,
});

const anon = (id: string): AuthUser => ({ id, email: null, is_anonymous: true });

function fake(w: World): AccountSessionDeps {
  let n = 0;
  const holder = (email: string) => [...w.users.values()].find((u) => u.email === email);
  const linkedProfiles = () => new Set(w.links.values());
  return {
    secret: SECRET,
    db: {
      linkedProfile: async (p, s) => (
        w.calls.push("db.linkedProfile"),
        w.links.get(`${p}:${s}`) ?? null
      ),
      linkedAmong: async (ids) => (
        w.calls.push("db.linkedAmong"),
        ids.filter((id) => linkedProfiles().has(id))
      ),
      lastActive: async (ids) => (
        w.calls.push("db.lastActive"),
        Object.fromEntries(ids.map((id) => [id, w.activity[id] ?? 0]))
      ),
      userIdByEmail: async (email) => (w.calls.push("db.userIdByEmail"), holder(email)?.id ?? null),
      linkAndMerge: async (p, s, main, merge) => {
        w.calls.push("db.linkAndMerge");
        const key = `${p}:${s}`;
        const existing = w.links.get(key);
        if (existing && existing !== main) throw new HttpError(409, "conflict");
        if (!existing && linkedProfiles().has(main)) throw new HttpError(409, "conflict");
        w.links.set(key, main);
        for (const other of merge) w.merges.push([main, other]);
        return !existing;
      },
      touchRateLimit: async (hash) => {
        w.calls.push("db.touchRateLimit");
        const last = w.rate.get(hash);
        if (last !== undefined && Date.now() - last < 10_000) return false;
        w.rate.set(hash, Date.now());
        return true;
      },
    },
    authAdmin: {
      getUser: async (id) => (w.calls.push(`getUser:${id}`), w.users.get(id) ?? null),
      updateUserById: async (id, { email }) => {
        w.calls.push(`updateUserById:${id}`);
        const h = holder(email);
        if (h && h.id !== id) throw new EmailTakenError(email);
        w.users.set(id, { id, email, is_anonymous: false });
      },
      createUser: async ({ email }) => {
        w.calls.push("createUser");
        if (holder(email)) throw new EmailTakenError(email);
        const u = { id: `new-${++n}`, email, is_anonymous: false };
        w.users.set(u.id, u);
        return u;
      },
      deleteUser: async (id) => {
        w.calls.push(`deleteUser:${id}`);
        w.users.delete(id);
        for (const [k, v] of w.links) if (v === id) w.links.delete(k);
      },
    },
    openSession: async (email) => {
      const u = holder(email);
      if (!u) throw new Error("no user for this email");
      w.calls.push(`openSession:${u.id}`);
      return { access_token: `at-${u.id}`, refresh_token: `rt-${u.id}` };
    },
    hooks: {
      candidates: async () => w.candidates,
      ownsProfile: async () => w.owns,
      onLinked: async () => void w.linkedHook++,
    },
  };
}

const verified = { provider: "appwrite", subject: "acct-1", claims: {} };

async function run(w: World, callerId: string | null, verify = async () => verified) {
  return accountSessionResponse({ ...fake(w), verify }, { proof: "proof", callerId });
}

Deno.test("new account, owned anonymous caller is converted", async () => {
  const w = world({ users: new Map([["c", anon("c")]]) });
  const res = await run(w, "c");
  assertEquals(res.status, 200);
  const email = await syntheticEmail(SECRET, "appwrite", "acct-1");
  assertEquals(res.body, {
    access_token: "at-c",
    refresh_token: "rt-c",
    profile_id: "c",
    subject_hash: email.slice(8, 40),
  });
  assertMatch((res.body as { subject_hash: string }).subject_hash, /^[0-9a-f]{32}$/);
  assert(w.calls.includes("updateUserById:c"));
  assert(!w.calls.includes("createUser"));
  assertEquals(w.links.get("appwrite:acct-1"), "c");
  assertEquals(w.merges, []);
  assertEquals(w.linkedHook, 1);
});

Deno.test("existing link: a second device is merged into the account profile", async () => {
  const email = await syntheticEmail(SECRET, "appwrite", "acct-1");
  const w = world({
    links: new Map([["appwrite:acct-1", "main"]]),
    users: new Map([
      ["main", { id: "main", email, is_anonymous: false }],
      ["d", anon("d")],
    ]),
  });
  const res = await run(w, "d");
  assertEquals(res.status, 200);
  assertEquals((res.body as { profile_id: string }).profile_id, "main");
  assert(w.calls.includes("openSession:main"));
  assertEquals(w.merges, [["main", "d"]]);
  assertEquals(w.linkedHook, 0);
  assert(!w.calls.some((c) => c.startsWith("updateUserById") || c === "createUser"));
});

Deno.test("candidates adopt the most active profile", async () => {
  const now = Date.now();
  const w = world({
    users: new Map([
      ["p1", anon("p1")],
      ["p2", anon("p2")],
    ]),
    candidates: ["p2", "p1"],
    activity: { p1: now - DAY, p2: now - 7 * DAY },
  });
  const res = await run(w, null);
  assertEquals(res.status, 200);
  assertEquals((res.body as { profile_id: string }).profile_id, "p1");
  assertEquals(w.merges, [["p1", "p2"]]);
  assert(w.calls.includes("updateUserById:p1"));
  assertEquals(w.linkedHook, 1);
});

Deno.test("candidates already linked to another account are skipped", async () => {
  const w = world({
    links: new Map([["appwrite:other", "p1"]]),
    users: new Map([
      ["p1", anon("p1")],
      ["c", anon("c")],
    ]),
    candidates: ["p1"],
  });
  const res = await run(w, "c");
  assertEquals((res.body as { profile_id: string }).profile_id, "c");
  assertEquals(w.merges, []);
});

Deno.test("foreign profile is left aside: caller linked to another account", async () => {
  const w = world({
    // Still anonymous: an interrupted call linked it but never set its email.
    links: new Map([["appwrite:other", "c"]]),
    users: new Map([["c", anon("c")]]),
  });
  const res = await run(w, "c");
  assertEquals(res.status, 200);
  assertEquals((res.body as { profile_id: string }).profile_id, "new-1");
  assert(!w.calls.includes("updateUserById:c"));
  assertEquals(w.merges, []);
});

Deno.test("foreign profile is left aside: account_owns_profile says no", async () => {
  const w = world({ users: new Map([["c", anon("c")]]), owns: false });
  const res = await run(w, "c");
  assertEquals((res.body as { profile_id: string }).profile_id, "new-1");
  assert(!w.calls.includes("updateUserById:c"));
  assertEquals(w.merges, []);
});

Deno.test("a non-anonymous caller is neither converted nor merged", async () => {
  const w = world({ users: new Map([["c", { id: "c", email: "e@x", is_anonymous: false }]]) });
  const res = await run(w, "c");
  assertEquals((res.body as { profile_id: string }).profile_id, "new-1");
  assertEquals(w.merges, []);
});

Deno.test("squatter is replaced and its session is never opened", async () => {
  const email = await syntheticEmail(SECRET, "appwrite", "acct-1");
  const w = world({ users: new Map([["s", { id: "s", email, is_anonymous: false }]]) });
  const res = await run(w, null);
  assertEquals(res.status, 200);
  assertEquals((res.body as { profile_id: string }).profile_id, "new-1");
  assertEquals(
    w.calls.filter((c) => c === "createUser" || c.startsWith("deleteUser")),
    ["createUser", "deleteUser:s", "createUser"],
  );
  assert(!w.calls.includes("openSession:s"));
});

Deno.test("a linked user holding the email is never deleted", async () => {
  const email = await syntheticEmail(SECRET, "appwrite", "acct-1");
  const w = world({
    links: new Map([["appwrite:other", "s"]]),
    users: new Map([["s", { id: "s", email, is_anonymous: false }]]),
  });
  const res = await run(w, null);
  assertEquals(res.status, 409);
  assert(!w.calls.includes("deleteUser:s"));
});

Deno.test("link conflict answers 409", async () => {
  const w = world({ users: new Map([["c", anon("c")]]) });
  const deps = fake(w);
  deps.db.linkAndMerge = async () => {
    throw new HttpError(409, "conflict");
  };
  const res = await accountSessionResponse(
    { ...deps, verify: async () => verified },
    { proof: "p", callerId: "c" },
  );
  assertEquals(res, { status: 409, body: { error: "conflict" } });
});

Deno.test("a second call within 10 s is rate limited", async () => {
  const w = world({ users: new Map([["c", anon("c")]]) });
  assertEquals((await run(w, "c")).status, 200);
  assertEquals(await run(w, "c"), { status: 429, body: { error: "rate_limited" } });
});

Deno.test("bad proof answers 401 without touching the db", async () => {
  const w = world();
  const res = await run(w, "c", () => Promise.reject(new AccountProofError("bad")));
  assertEquals(res, { status: 401, body: { error: "bad_proof" } });
  assertEquals(w.calls, []);
});

Deno.test("provider down answers 503", async () => {
  const w = world();
  const res = await run(w, "c", () => Promise.reject(new AccountProviderError("down")));
  assertEquals(res, { status: 503, body: { error: "provider_unavailable" } });
  assertEquals(w.calls, []);
});
