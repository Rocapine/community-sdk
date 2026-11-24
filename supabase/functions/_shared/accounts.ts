import * as jose from "jsr:@panva/jose@6";

export type VerifiedAccount = {
  provider: string;
  subject: string;
  claims: Record<string, unknown>;
};

export type AccountEnv =
  | { provider: "appwrite"; secret: string; endpoint: string; project: string }
  | {
      provider: "jwks";
      secret: string;
      jwksUrl: string;
      issuer: string;
      audience: string;
      subjectClaim: string;
    };

/** The proof is invalid or expired: answer 401. */
export class AccountProofError extends Error {}
/** The provider is unreachable or misconfigured: answer 503. */
export class AccountProviderError extends Error {}

/** Same account => same address, but the address cannot be reversed or guessed without the secret. */
export async function syntheticEmail(
  secret: string,
  provider: string,
  subject: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${provider}:${subject}`)),
  );
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return `account+${hex.slice(0, 32)}@account.invalid`;
}

export function readAccountEnv(get: (k: string) => string | undefined): AccountEnv {
  const need = (k: string) => {
    const v = get(k);
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  const provider = need("COMMUNITY_ACCOUNT_PROVIDER");
  const secret = need("COMMUNITY_ACCOUNT_SECRET");
  if (provider === "appwrite") {
    return {
      provider,
      secret,
      endpoint: need("COMMUNITY_APPWRITE_ENDPOINT").replace(/\/$/, ""),
      project: need("COMMUNITY_APPWRITE_PROJECT"),
    };
  }
  if (provider === "jwks") {
    return {
      provider,
      secret,
      jwksUrl: need("COMMUNITY_ACCOUNT_JWKS_URL"),
      issuer: need("COMMUNITY_ACCOUNT_ISSUER"),
      audience: need("COMMUNITY_ACCOUNT_AUDIENCE"),
      subjectClaim: get("COMMUNITY_ACCOUNT_SUBJECT_CLAIM") || "sub",
    };
  }
  throw new Error(`COMMUNITY_ACCOUNT_PROVIDER must be "appwrite" or "jwks", got "${provider}"`);
}

export async function verifyProof(
  proof: string,
  env: AccountEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedAccount> {
  return env.provider === "appwrite"
    ? verifyAppwrite(proof, env, fetchImpl)
    : verifyJwks(proof, env, fetchImpl);
}

async function verifyAppwrite(
  jwt: string,
  env: Extract<AccountEnv, { provider: "appwrite" }>,
  fetchImpl: typeof fetch,
): Promise<VerifiedAccount> {
  let res: Response;
  try {
    res = await fetchImpl(`${env.endpoint}/account`, {
      headers: { "X-Appwrite-Project": env.project, "X-Appwrite-JWT": jwt },
    });
  } catch (e) {
    throw new AccountProviderError(`appwrite unreachable: ${e}`);
  }
  if (res.status === 401) throw new AccountProofError("appwrite rejected the proof");
  if (!res.ok) throw new AccountProviderError(`appwrite answered ${res.status}`);
  const u = await res.json();
  if (u.status === false) throw new AccountProofError("account is blocked");
  if (typeof u.$id !== "string" || !u.$id)
    throw new AccountProviderError("appwrite answer has no $id");
  return {
    provider: "appwrite",
    subject: u.$id,
    claims: { prefs: u.prefs, emailVerification: u.emailVerification, status: u.status },
  };
}

async function verifyJwks(
  token: string,
  env: Extract<AccountEnv, { provider: "jwks" }>,
  fetchImpl: typeof fetch,
): Promise<VerifiedAccount> {
  // createRemoteJWKSet caches per instance; a fresh one per call is fine for a function that runs once per sign-in.
  const jwks = jose.createRemoteJWKSet(new URL(env.jwksUrl), { [jose.customFetch]: fetchImpl });
  try {
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer: env.issuer,
      audience: env.audience,
    });
    const subject = payload[env.subjectClaim];
    if (typeof subject !== "string" || !subject)
      throw new AccountProofError(`token has no ${env.subjectClaim}`);
    return { provider: "jwks", subject, claims: payload as Record<string, unknown> };
  } catch (e) {
    if (e instanceof AccountProofError) throw e;
    // A JWKS that cannot be fetched is the provider's problem, not the caller's.
    if (
      e instanceof jose.errors.JWKSTimeout ||
      (e instanceof jose.errors.JOSEError && e.code === "ERR_JOSE_GENERIC")
    ) {
      throw new AccountProviderError(`jwks unavailable: ${e.message}`);
    }
    throw new AccountProofError(e instanceof Error ? e.message : "invalid token");
  }
}
