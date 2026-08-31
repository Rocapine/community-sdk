// Real-time report alert: a pg_net trigger on INSERT INTO reports posts the
// record here; we enrich it with the reported account's identity and its
// cumulative report count, then alert Slack (no-op if SLACK_WEBHOOK_URL is
// unset — see _shared/slack.ts). Bans stay manual (dashboard).

import { adminClient } from "../_shared/client.ts";
import { postToSlack } from "../_shared/slack.ts";

const supabase = adminClient();

interface ReportRecord {
  reported_user_id: string;
  reason: string;
  details: string | null;
}

Deno.serve(async (req) => {
  const { record } = (await req.json()) as { record: ReportRecord };

  const { data: reported } = await supabase
    .from("profiles")
    .select("username, amplitude_id, revenuecat_id")
    .eq("id", record.reported_user_id)
    .single();
  const { count } = await supabase
    .from("reports")
    .select("*", { count: "exact", head: true })
    .eq("reported_user_id", record.reported_user_id);

  await postToSlack({
    text:
      `:rotating_light: Report (*${record.reason}*) against *${reported?.username ?? record.reported_user_id}*, ${count ?? "?"} report(s) total\n` +
      `${record.details ? `> ${record.details}\n` : ""}` +
      `amplitude: \`${reported?.amplitude_id ?? "?"}\` | revenuecat: \`${reported?.revenuecat_id ?? "?"}\``,
  });
  return new Response("ok");
});
