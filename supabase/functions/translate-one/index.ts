// Translate one published post or comment into every target locale. Called by
// the pg_net triggers in translation/001 (anon key, untrusted body: only
// `kind` and `id` are read, the row is re-read). Idempotent: an item that
// already has every translation costs no API call.

import { adminClient, json } from "../_shared/client.ts";
import { ensureTranslations } from "../_shared/translation.ts";

const supabase = adminClient();

Deno.serve(async (req) => {
  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; id?: unknown };
  const kind = body.kind === "post" || body.kind === "comment" ? body.kind : null;
  if (!kind || typeof body.id !== "string")
    return json({ status: "error", error: "bad request" }, 400);

  const rows = await ensureTranslations(supabase, kind, body.id);
  if (rows === null) return json({ status: "failed" }, 502);
  return json({ status: rows.length === 0 ? "skipped" : "ok", locales: rows.map((r) => r.locale) });
});
