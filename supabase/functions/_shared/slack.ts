export async function postToSlack(payload: unknown): Promise<void> {
  const url = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!url) {
    console.log("community-sdk: SLACK_WEBHOOK_URL not set, skipping Slack notification");
    return;
  }
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
