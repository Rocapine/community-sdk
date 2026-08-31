// Shared Expo push sender. Used by notify-comment, notify-like,
// notify-reaction and broadcast-post (push module).

export interface ExpoPushMessage {
  to: string;
  title: string;
  body?: string;
  data: Record<string, string>;
  // badge: 1 is a "something new" dot, not a real unread count — the app
  // clears it on every foreground.
  badge?: number;
}

// Sends in chunks of 100 (Expo API limit). Best-effort: push failures must
// never fail the calling webhook. Projects with Enhanced Security for push
// must set the EXPO_ACCESS_TOKEN function secret.
export async function sendExpoPushBatch(messages: ExpoPushMessage[]): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers,
      body: JSON.stringify(chunk.length === 1 ? chunk[0] : chunk),
    }).catch(() => {});
  }
}

export async function sendExpoPush(message: ExpoPushMessage): Promise<void> {
  await sendExpoPushBatch([message]);
}
