// account-delete: POST { proof }, or { provider, subject } with the service role.
// Resets the account profile's identity, drops its push rows, revokes its sessions and unlinks
// the account: 200 { deleted } (false when no profile was linked), 401 bad_proof,
// 503 provider_unavailable. Logic: _shared/account-session.ts.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { readAccountEnv, verifyProof } from "../_shared/accounts.ts";
import { accountDeleteResponse, supabaseAccountDeps } from "../_shared/account-session.ts";
import { adminClient, isServiceCaller, json, preflight, SUPABASE_URL } from "../_shared/client.ts";

const env = readAccountEnv((k) => Deno.env.get(k));
const deps = supabaseAccountDeps(
  adminClient(),
  () =>
    createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  env.secret,
);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  let body: { proof?: unknown; provider?: unknown; subject?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const { proof, provider, subject } = body ?? {};
  let input: Parameters<typeof accountDeleteResponse>[1];
  if (typeof proof === "string" && proof) {
    input = { proof };
  } else if (typeof provider === "string" && typeof subject === "string" && provider && subject) {
    // Without a proof, only the service role may name the account.
    if (!isServiceCaller(req)) return json({ error: "bad_proof" }, 401);
    input = { service: { provider, subject } };
  } else {
    return json({ error: "bad_request" }, 400);
  }
  const { status, body: out } = await accountDeleteResponse(
    { ...deps, verify: (p) => verifyProof(p, env) },
    input,
  );
  return json(out, status);
});
