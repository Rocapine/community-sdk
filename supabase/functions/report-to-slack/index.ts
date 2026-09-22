// Real-time report alert: a pg_net trigger on INSERT INTO reports posts the
// record here; we enrich it with the reported account's identity and its
// cumulative report count, then alert Slack (no-op if SLACK_WEBHOOK_URL is
// unset — see _shared/slack.ts). Bans stay manual (dashboard).
//
// Security: reachable with the anon key, so only `record.id` is trusted; the
// report row is re-read from the database (a forged body can't inject text
// into the ops channel or probe another user's report count).

import { adminClient } from "../_shared/client.ts";
import { postToSlack } from "../_shared/slack.ts";

const supabase = adminClient();

Deno.serve(async (req) => {
  const { record } = (await req.json().catch(() => ({}))) as { record?: { id?: string } };
  if (!record?.id) return new Response("skip: no id", { status: 400 });

  const { data: report } = await supabase
    .from("reports")
    .select("id, reported_user_id, reason, details")
    .eq("id", record.id)
    .single();
  if (!report) return new Response("skip: unknown report");

  const { data: reported } = await supabase
    .from("profiles")
    .select("username, amplitude_id, revenuecat_id")
    .eq("id", report.reported_user_id)
    .single();
  const { count } = await supabase
    .from("reports")
    .select("*", { count: "exact", head: true })
    .eq("reported_user_id", report.reported_user_id);

  await postToSlack({
    text:
      `:rotating_light: Report (*${report.reason}*) against *${reported?.username ?? report.reported_user_id}*, ${count ?? "?"} report(s) total\n` +
      `${report.details ? `> ${report.details}\n` : ""}` +
      `amplitude: \`${reported?.amplitude_id ?? "?"}\` | revenuecat: \`${reported?.revenuecat_id ?? "?"}\``,
  });
  return new Response("ok");
});
