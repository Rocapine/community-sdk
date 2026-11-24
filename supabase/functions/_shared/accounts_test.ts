import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1";
import * as jose from "jsr:@panva/jose@6";
import {
  AccountProofError,
  AccountProviderError,
  readAccountEnv,
  syntheticEmail,
  verifyProof,
  type AccountEnv,
} from "./accounts.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.test("syntheticEmail is a deterministic peppered pseudonym", async () => {
  const a = await syntheticEmail("s1", "appwrite", "u1");
  assertMatch(a, /^account\+[0-9a-f]{32}@account\.invalid$/);
  assertEquals(a, await syntheticEmail("s1", "appwrite", "u1"));
  assertNotEquals(a, await syntheticEmail("s2", "appwrite", "u1"));
  assertNotEquals(a, await syntheticEmail("s1", "jwks", "u1"));
});

const appwriteEnv: AccountEnv = {
  provider: "appwrite",
  secret: "s",
  endpoint: "https://aw.test/v1",
  project: "proj",
};

Deno.test("appwrite: valid JWT yields subject and claims, with the right headers", async () => {
  let seen: Request | undefined;
  const f = ((u: string, init: RequestInit) => {
    seen = new Request(u, init);
    return Promise.resolve(
      json({ $id: "u1", prefs: { a: 1 }, emailVerification: true, status: true }),
    );
  }) as unknown as typeof fetch;
  const v = await verifyProof("jwt", appwriteEnv, f);
  assertEquals(v, {
    provider: "appwrite",
    subject: "u1",
    claims: { prefs: { a: 1 }, emailVerification: true, status: true },
  });
  assertEquals(seen?.url, "https://aw.test/v1/account");
  assertEquals(seen?.headers.get("X-Appwrite-Project"), "proj");
  assertEquals(seen?.headers.get("X-Appwrite-JWT"), "jwt");
});

Deno.test("appwrite: 401 is a bad proof, a blocked user is a bad proof", async () => {
  await assertRejects(
    () => verifyProof("j", appwriteEnv, () => Promise.resolve(json({}, 401))),
    AccountProofError,
  );
  await assertRejects(
    () => verifyProof("j", appwriteEnv, () => Promise.resolve(json({ $id: "u", status: false }))),
    AccountProofError,
  );
});

Deno.test("appwrite: unreachable or erroring provider is a provider error", async () => {
  await assertRejects(
    () => verifyProof("j", appwriteEnv, () => Promise.reject(new Error("down"))),
    AccountProviderError,
  );
  await assertRejects(
    () => verifyProof("j", appwriteEnv, () => Promise.resolve(json({}, 500))),
    AccountProviderError,
  );
});

Deno.test(
  "appwrite: hanging provider times out, malformed bodies are provider errors",
  async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, rej) =>
        init.signal?.addEventListener("abort", () => rej(new DOMException("t", "AbortError"))),
      )) as unknown as typeof fetch;
    const t = performance.now();
    await assertRejects(() => verifyProof("j", appwriteEnv, hang), AccountProviderError);
    assert(performance.now() - t < 7000);
    await assertRejects(
      () => verifyProof("j", appwriteEnv, () => Promise.resolve(new Response("<html>"))),
      AccountProviderError,
    );
    await assertRejects(
      () => verifyProof("j", appwriteEnv, () => Promise.resolve(json(null))),
      AccountProviderError,
    );
  },
);

Deno.test("jwks: valid token passes, wrong audience is a bad proof", async () => {
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const f = (() => Promise.resolve(json({ keys: [jwk] }))) as unknown as typeof fetch;
  const env: AccountEnv = {
    provider: "jwks",
    secret: "s",
    jwksUrl: "https://idp.test/jwks.json",
    issuer: "https://idp.test",
    audience: "app",
    subjectClaim: "uid",
  };
  const sign = (
    aud: string,
    o: { iss?: string; exp?: string | number; claims?: Record<string, unknown> } = {},
  ) =>
    new jose.SignJWT(o.claims ?? { uid: "abc" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(o.iss ?? "https://idp.test")
      .setAudience(aud)
      .setExpirationTime(o.exp ?? "5m")
      .sign(privateKey);
  const ok = await verifyProof(await sign("app"), env, f);
  assertEquals(ok.provider, "jwks");
  assertEquals(ok.subject, "abc");
  assertEquals(ok.claims.uid, "abc");
  await assertRejects(async () => verifyProof(await sign("other"), env, f), AccountProofError);
  await assertRejects(
    async () => verifyProof(await sign("app", { iss: "https://evil.test" }), env, f),
    AccountProofError,
  );
  await assertRejects(
    async () =>
      verifyProof(await sign("app", { exp: Math.floor(Date.now() / 1000) - 3600 }), env, f),
    AccountProofError,
  );
  await assertRejects(
    async () => verifyProof(await sign("app", { claims: { other: 1 } }), env, f),
    AccountProofError,
  );
  await assertRejects(() => verifyProof("not-a-jwt", env, f), AccountProofError);
  const refused = (() => Promise.reject(new TypeError("down"))) as unknown as typeof fetch;
  await assertRejects(
    async () => verifyProof(await sign("app"), env, refused),
    AccountProviderError,
  );
  const down = (() => Promise.resolve(json({}, 500))) as unknown as typeof fetch;
  await assertRejects(async () => verifyProof(await sign("app"), env, down), AccountProviderError);
});

Deno.test("readAccountEnv requires the secrets of the chosen provider", () => {
  const get = (m: Record<string, string>) => (k: string) => m[k];
  assertThrows(() => readAccountEnv(get({ COMMUNITY_ACCOUNT_PROVIDER: "appwrite" })));
  assertThrows(() =>
    readAccountEnv(get({ COMMUNITY_ACCOUNT_PROVIDER: "appwrite", COMMUNITY_ACCOUNT_SECRET: "s" })),
  );
  assertThrows(() =>
    readAccountEnv(get({ COMMUNITY_ACCOUNT_PROVIDER: "nope", COMMUNITY_ACCOUNT_SECRET: "s" })),
  );
  assertEquals(
    readAccountEnv(
      get({
        COMMUNITY_ACCOUNT_PROVIDER: "jwks",
        COMMUNITY_ACCOUNT_SECRET: "s",
        COMMUNITY_ACCOUNT_JWKS_URL: "u",
        COMMUNITY_ACCOUNT_ISSUER: "i",
        COMMUNITY_ACCOUNT_AUDIENCE: "a",
      }),
    ),
    {
      provider: "jwks",
      secret: "s",
      jwksUrl: "u",
      issuer: "i",
      audience: "a",
      subjectClaim: "sub",
    },
  );
});
