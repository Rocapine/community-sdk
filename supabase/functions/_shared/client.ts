// Shared Supabase admin client, caller identity helpers + JSON response helper.

import { createClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// Service-role client: bypasses RLS. Every function does privileged work
// through this; callers only ever pass the public anon JWT (verify_jwt) or a
// user JWT.
export function adminClient() {
  return createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// The gateway (verify_jwt) has already validated the bearer's signature, so
// only the role claim needs checking here. An exact string match against the
// injected SUPABASE_SERVICE_ROLE_KEY broke when a project migrated to the new
// API keys: the runtime then receives the sb_secret_* value while callers
// still hold the legacy service_role JWT. Accept either proof.
export function isServiceCaller(req: Request): boolean {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  try {
    const payload = JSON.parse(
      atob(bearer.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

// The user behind the request's bearer, or null for an anon-key-only call
// (or an invalid/expired user JWT). Resolved through Auth so a forged `sub`
// claim can't be smuggled in with a plain anon token.
export async function callerUserId(req: Request): Promise<string | null> {
  const authorization = req.headers.get("authorization");
  if (!authorization) return null;
  const client = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

// The client consumes responses via supabase.functions.invoke, which only
// parses the body as JSON when the Content-Type says so. Without this header
// invoke returns a raw string and verdict.status is undefined.
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
