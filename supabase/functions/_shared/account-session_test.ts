import { assert, assertEquals, assertMatch, assertRejects } from "jsr:@std/assert@1";
import { AccountProofError, AccountProviderError, syntheticEmail } from "./accounts.ts";
import {
  accountDeleteResponse,
  accountSessionResponse,
  EmailTakenError,
  HttpError,
  isLinkConflict,
  parseDeleteRequest,
  supabaseAccountDeps,
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
  owns: boolean | null | undefined; // undefined: hook not installed; null: it returned SQL NULL
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
  owns: undefined,
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
      lastActive: async (ids) => {
        w.calls.push("db.lastActive");
        // Like the SQL: only ids that still have a profile come back.
        return Object.fromEntries(
          ids.filter((id) => w.users.has(id)).map((id) => [id, w.activity[id] ?? 0]),
        );
      },
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
      deleteProfileData: async (id) => void w.calls.push(`db.deleteProfileData:${id}`),
      unlink: async (p, s) => {
        w.calls.push(`db.unlink:${p}:${s}`);
        w.links.delete(`${p}:${s}`);
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

Deno.test("foreign profile is left aside: account_owns_profile returns NULL", async () => {
  const w = world({ users: new Map([["c", anon("c")]]), owns: null });
  const res = await run(w, "c");
  assertEquals((res.body as { profile_id: string }).profile_id, "new-1");
  assert(!w.calls.includes("updateUserById:c"));
  assertEquals(w.merges, []);
});

Deno.test("an interrupted call is resumed: linked, still anonymous, no email", async () => {
  const w = world({
    links: new Map([["appwrite:acct-1", "c"]]),
    users: new Map([["c", anon("c")]]),
  });
  const res = await run(w, "c");
  assertEquals(res.status, 200);
  assertEquals((res.body as { profile_id: string }).profile_id, "c");
  assert(w.calls.includes("updateUserById:c"));
  assert(!w.calls.includes("createUser"));
  assert(!w.calls.some((c) => c.startsWith("deleteUser")));
  assertEquals(w.merges, []);
  assertEquals(w.linkedHook, 1, "the hook the first call never ran");
});

Deno.test("a candidate that is not anonymous is never adopted (its real email stays)", async () => {
  const now = Date.now();
  const w = world({
    users: new Map([
      ["real", { id: "real", email: "member@example.com", is_anonymous: false }],
      ["p1", anon("p1")],
    ]),
    candidates: ["real", "p1"],
    activity: { real: now, p1: now - DAY },
  });
  const res = await run(w, null);
  assertEquals((res.body as { profile_id: string }).profile_id, "p1");
  assertEquals(w.merges, []);
  assertEquals(w.users.get("real")?.email, "member@example.com");
});

Deno.test("relaunch: the bearer already is the account's session, nothing is minted", async () => {
  const email = await syntheticEmail(SECRET, "appwrite", "acct-1");
  const w = world({
    links: new Map([["appwrite:acct-1", "main"]]),
    users: new Map([["main", { id: "main", email, is_anonymous: false }]]),
  });
  const first = await run(w, "main");
  assertEquals(first, {
    status: 200,
    body: { profile_id: "main", subject_hash: email.slice(8, 40) },
  });
  // The check never takes the rate limit slot: the host's own accountSignedIn() right after passes.
  assertEquals((await run(w, "main")).status, 200);
  assert(!w.calls.some((c) => c.startsWith("openSession") || c === "db.touchRateLimit"));
  assertEquals(w.merges, []);
  assertEquals(w.linkedHook, 0);
});

Deno.test("relaunch: another account's session as bearer still gets a session", async () => {
  const w = world({
    links: new Map([["appwrite:acct-1", "main"]]),
    users: new Map([
      [
        "main",
        {
          id: "main",
          email: await syntheticEmail(SECRET, "appwrite", "acct-1"),
          is_anonymous: false,
        },
      ],
      [
        "b",
        { id: "b", email: await syntheticEmail(SECRET, "appwrite", "acct-2"), is_anonymous: false },
      ],
    ]),
  });
  const res = await run(w, "b");
  assertEquals((res.body as { access_token: string }).access_token, "at-main");
  assertEquals(w.merges, []);
});

Deno.test("a candidate without a profile is ignored", async () => {
  const w = world({
    users: new Map([["p1", anon("p1")]]),
    candidates: ["ghost", "p1"],
    activity: { ghost: Date.now() },
  });
  const res = await run(w, null);
  assertEquals((res.body as { profile_id: string }).profile_id, "p1");
  assertEquals(w.merges, []);
});

Deno.test("email taken but its holder gone: the operation is retried", async () => {
  const w = world();
  const deps = fake(w);
  const create = deps.authAdmin.createUser;
  let first = true;
  deps.authAdmin.createUser = (attrs) => {
    if (first) {
      first = false;
      return Promise.reject(new EmailTakenError(attrs.email));
    }
    return create(attrs);
  };
  const res = await accountSessionResponse(
    { ...deps, verify: async () => verified },
    { proof: "p", callerId: null },
  );
  assertEquals(res.status, 200);
  assert(!w.calls.some((c) => c.startsWith("deleteUser")));
});

Deno.test("only the account-links conflicts are 409s", () => {
  assert(
    isLinkConflict({
      code: "23505",
      message: "account_link_and_merge: the account is linked to another profile",
    }),
  );
  assert(
    isLinkConflict({
      code: "23505",
      message: 'duplicate key value violates unique constraint "account_links_profile_id_key"',
    }),
  );
  assert(
    !isLinkConflict({
      code: "23505",
      message: 'duplicate key value violates unique constraint "likes_pkey"',
    }),
  );
  assert(!isLinkConflict({ code: "P0001", message: "account_links_profile_id_key" }));
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
  // Another device (no bearer) would mint a second session.
  assertEquals(await run(w, null), { status: 429, body: { error: "rate_limited" } });
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

Deno.test("delete resets, revokes, retires the email, then unlinks", async () => {
  const email = await syntheticEmail(SECRET, "appwrite", "acct-1");
  const w = world({
    links: new Map([["appwrite:acct-1", "main"]]),
    users: new Map([["main", { id: "main", email, is_anonymous: false }]]),
  });
  const res = await accountDeleteResponse(
    { ...fake(w), verify: async () => verified },
    { proof: "proof" },
  );
  assertEquals(res, { status: 200, body: { deleted: true } });
  assertEquals(
    w.calls.filter(
      (c) =>
        c.startsWith("db.delete") || c.startsWith("db.unlink") || c.startsWith("updateUserById"),
    ),
    ["db.deleteProfileData:main", "updateUserById:main", "db.unlink:appwrite:acct-1"],
  );
  assertEquals(w.links.size, 0);
  assertMatch(w.users.get("main")!.email!, /^[0-9a-f-]{36}@deleted\.invalid$/);
});

Deno.test("delete: the service role needs no proof", async () => {
  const w = world({
    links: new Map([["appwrite:acct-1", "main"]]),
    users: new Map([["main", { id: "main", email: "x", is_anonymous: false }]]),
  });
  const res = await accountDeleteResponse(
    {
      ...fake(w),
      verify: async () => {
        throw new Error("must not verify");
      },
    },
    { service: { provider: "appwrite", subject: "acct-1" } },
  );
  assertEquals(res, { status: 200, body: { deleted: true } });
  assertEquals(w.links.size, 0);
});

Deno.test("delete: an unknown account is a no-op", async () => {
  const w = world();
  const res = await accountDeleteResponse(
    { ...fake(w), verify: async () => verified },
    { proof: "proof" },
  );
  assertEquals(res, { status: 200, body: { deleted: false } });
  assert(
    !w.calls.some(
      (c) => c.startsWith("db.delete") || c.startsWith("db.unlink") || c.startsWith("updateUser"),
    ),
  );
});

Deno.test("delete: bad proof is 401, provider outage 503", async () => {
  const w = world();
  const bad = await accountDeleteResponse(
    {
      ...fake(w),
      verify: async () => {
        throw new AccountProofError("no");
      },
    },
    { proof: "p" },
  );
  assertEquals(bad.status, 401);
  const down = await accountDeleteResponse(
    {
      ...fake(w),
      verify: async () => {
        throw new AccountProviderError("down");
      },
    },
    { proof: "p" },
  );
  assertEquals(down.status, 503);
});

const linkedWorld = () =>
  world({
    links: new Map([["appwrite:acct-1", "main"]]),
    users: new Map([["main", { id: "main", email: "x", is_anonymous: false }]]),
  });
const del = (d: AccountSessionDeps) =>
  accountDeleteResponse({ ...d, verify: async () => verified }, { proof: "p" });

Deno.test("delete: a failed email step keeps the link, and a retry completes", async () => {
  const w = linkedWorld();
  const f = fake(w);
  const failing = {
    ...f,
    authAdmin: {
      ...f.authAdmin,
      updateUserById: async () => {
        throw new Error("auth down");
      },
    },
  };
  assertEquals((await del(failing)).status, 500);
  assertEquals(w.links.size, 1);
  assertEquals(await del(f), { status: 200, body: { deleted: true } });
  assertEquals(w.links.size, 0);
  assertMatch(w.users.get("main")!.email!, /@deleted\.invalid$/);
});

Deno.test("delete: a failed unlink after the rotation, and a retry completes", async () => {
  const w = linkedWorld();
  const f = fake(w);
  const failing = {
    ...f,
    db: {
      ...f.db,
      unlink: async () => {
        throw new Error("db down");
      },
    },
  };
  assertEquals((await del(failing)).status, 500);
  assertMatch(w.users.get("main")!.email!, /@deleted\.invalid$/);
  assertEquals(w.links.size, 1);
  assertEquals(await del(f), { status: 200, body: { deleted: true } });
  assertEquals(w.links.size, 0);
});

Deno.test("parseDeleteRequest: only the service role may name an account", () => {
  const named = { provider: "appwrite", subject: "acct-1" };
  assertEquals(parseDeleteRequest(named, false), { status: 401, error: "bad_proof" });
  assertEquals(parseDeleteRequest(named, true), { input: { service: named } });
  assertEquals(parseDeleteRequest({ proof: "p" }, false), { input: { proof: "p" } });
  assertEquals(parseDeleteRequest({ proof: "p", ...named }, false), { input: { proof: "p" } });
  assertEquals(parseDeleteRequest({}, true), { status: 400, error: "bad_request" });
  assertEquals(parseDeleteRequest(null, true), { status: 400, error: "bad_request" });
});

// GoTrue answers an admin email change onto a taken address with a bare 500, not email_exists.
Deno.test(
  "supabaseAccountDeps: a 500 on an email held by another user is EmailTakenError",
  async () => {
    const admin = (holder: string | null) =>
      ({
        auth: {
          admin: {
            updateUserById: async () => ({
              data: { user: null },
              error: { status: 500, message: "Error updating user" },
            }),
          },
        },
        rpc: async () => ({ data: holder, error: null }),
      }) as unknown as Parameters<typeof supabaseAccountDeps>[0];
    const update = (holder: string | null) =>
      supabaseAccountDeps(admin(holder), () => admin(null), SECRET).authAdmin.updateUserById("me", {
        email: "a@b.c",
        email_confirm: true,
      });
    await assertRejects(() => update("someone-else"), EmailTakenError);
    const other = await update(null).catch((e) => e);
    assert(!(other instanceof EmailTakenError));
    const own = await update("me").catch((e) => e);
    assert(!(own instanceof EmailTakenError));
  },
);
