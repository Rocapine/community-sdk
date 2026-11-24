// account-session: POST { proof } with the device's access token, if any, as the bearer.
// Verifies the host account's proof, then answers the account profile's session:
// 200 { access_token, refresh_token, profile_id, subject_hash }, 401 bad_proof,
// 409 conflict, 429 rate_limited, 503 provider_unavailable. Logic: _shared/account-session.ts.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { readAccountEnv, verifyProof } from "../_shared/accounts.ts";
import { accountSessionResponse, supabaseAccountDeps } from "../_shared/account-session.ts";
import { adminClient, callerUserId, json, preflight, SUPABASE_URL } from "../_shared/client.ts";

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
  let proof: unknown;
  try {
    ({ proof } = await req.json());
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof proof !== "string" || !proof) return json({ error: "bad_request" }, 400);
  const { status, body } = await accountSessionResponse(
    { ...deps, verify: (p) => verifyProof(p, env) },
    { proof, callerId: await callerUserId(req) },
  );
  return json(body, status);
});
