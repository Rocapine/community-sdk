// account-delete: POST { proof }, or { provider, subject } with the service role.
// Resets the account profile's identity, drops its push rows, revokes its sessions and unlinks
// the account: 200 { deleted } (false when no profile was linked), 400 bad_request (no proof, or
// not JSON), 401 bad_proof, 500 internal (a step failed: call again, every step is idempotent),
// 503 provider_unavailable. Logic: _shared/account-session.ts.
// Deploy with verify_jwt ON: the service-role check relies on the gateway verifying the JWT signature.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { readAccountEnv, verifyProof } from "../_shared/accounts.ts";
import {
  accountDeleteResponse,
  parseDeleteRequest,
  supabaseAccountDeps,
} from "../_shared/account-session.ts";
import { adminClient, isServiceCaller, json, preflight, SUPABASE_URL } from "../_shared/client.ts";

const env = readAccountEnv((k) => Deno.env.get(k));
const admin = adminClient();
const base = supabaseAccountDeps(
  admin,
  () =>
    createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  env.secret,
);
const deps = {
  ...base,
  db: {
    ...base.db,
    deleteProfileData: async (profile: string) => {
      // messaging.onAccountDelete (groups module) first; PGRST202 = the module isn't installed.
      const { error } = await admin.rpc("messaging_on_account_delete", { p_uid: profile });
      if (error && error.code !== "PGRST202") {
        throw new Error(`messaging_on_account_delete: ${error.message}`);
      }
      await base.db.deleteProfileData(profile);
    },
  },
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  let body: { proof?: unknown; provider?: unknown; subject?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const parsed = parseDeleteRequest(body, isServiceCaller(req));
  if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
  const input = parsed.input;
  const { status, body: out } = await accountDeleteResponse(
    { ...deps, verify: (p) => verifyProof(p, env) },
    input,
  );
  return json(out, status);
});
