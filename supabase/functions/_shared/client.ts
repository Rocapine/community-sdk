// Shared Supabase admin client + JSON response helper.

import { createClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// Service-role client: bypasses RLS. Every function does privileged work
// through this; callers only ever pass the public anon JWT (verify_jwt).
export function adminClient() {
  return createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// The client consumes responses via supabase.functions.invoke, which only
// parses the body as JSON when the Content-Type says so. Without this header
// invoke returns a raw string and verdict.status is undefined.
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
