// Real-time report alert: a pg_net trigger on INSERT INTO reports posts the
// record here; we enrich it with the reported account's identity and its
// cumulative report count, then alert Slack (no-op if SLACK_WEBHOOK_URL is
// unset — see _shared/slack.ts). Bans stay manual (dashboard).
//
// Security: reachable with the anon key, so only `record.id` is trusted; the
// report row is re-read from the database (a forged body can't inject text
// into the ops channel or probe another user's report count).

import { adminClient } from "../_shared/client.ts";
import { fetchImagePath, postImageUrl } from "../_shared/images.ts";
import { postToSlack } from "../_shared/slack.ts";

const supabase = adminClient();

const quote = (text: string | null | undefined) =>
  text ? `> ${text.slice(0, 500).replace(/\n/g, "\n> ")}\n` : "";

// A group message report shows the group's name and the message; a group report its
// name and description (live values only, never pending ones). A DM message shows
// no text. Lookup errors only drop the lines.
async function chatContext(report: { message_id?: string | null; group_id?: string | null }) {
  let groupId = report.group_id ?? null;
  let messageLine = "";
  if (report.message_id) {
    const { data: m } = await supabase
      .from("messages")
      .select("body, conversation_id, conversations(kind)")
      .eq("id", report.message_id)
      .single();
    const conv = Array.isArray(m?.conversations) ? m.conversations[0] : m?.conversations;
    if (!m || conv?.kind !== "group") return m ? "Message in a direct conversation\n" : "";
    groupId = m.conversation_id;
    messageLine = `Message:\n${quote(m.body) || "> (no text)\n"}`;
  }
  if (!groupId) return "";
  const { data: g } = await supabase
    .from("groups")
    .select("name, description")
    .eq("conversation_id", groupId)
    .single();
  const groupLine = `Group: *${g?.name ?? "(not yet approved)"}*\n`;
  return report.message_id ? groupLine + messageLine : groupLine + quote(g?.description);
}

Deno.serve(async (req) => {
  const { record } = (await req.json().catch(() => ({}))) as { record?: { id?: string } };
  if (!record?.id) return new Response("skip: no id", { status: 400 });

  // `*`: message_id / group_id exist only with the messaging / groups modules.
  const { data: report } = await supabase.from("reports").select("*").eq("id", record.id).single();
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

  // The reported item's image, when it has one. A failed lookup only drops the
  // line: an alert must never be blocked by it.
  const target = report.comment_id
    ? ({ table: "comments", id: report.comment_id } as const)
    : report.post_id
      ? ({ table: "posts", id: report.post_id } as const)
      : null;
  const image = target ? await fetchImagePath(supabase, target.table, target.id) : null;
  const imageLine = image?.ok && image.path ? `Image: ${postImageUrl(image.path)}\n` : "";
  const chatLines = await chatContext(report);

  await postToSlack({
    text:
      `:rotating_light: Report (*${report.reason}*) against *${reported?.username ?? report.reported_user_id}*, ${count ?? "?"} report(s) total\n` +
      `${report.details ? `> ${report.details}\n` : ""}` +
      imageLine +
      chatLines +
      `amplitude: \`${reported?.amplitude_id ?? "?"}\` | revenuecat: \`${reported?.revenuecat_id ?? "?"}\``,
  });
  return new Response("ok");
});
