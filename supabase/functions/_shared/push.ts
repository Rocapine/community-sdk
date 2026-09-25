// Shared Expo push sender. Used by notify-comment, notify-like,
// notify-reaction and broadcast-post (push module).

import { runPool } from "./translation.ts";

export interface ExpoPushMessage {
  to: string;
  title: string;
  body?: string;
  data: Record<string, string>;
  // badge: 1 is a "something new" dot, not a real unread count — the app
  // clears it on every foreground.
  badge?: number;
}

// Sends in chunks of 100 (Expo API limit), 4 requests in flight at a time, each
// aborted after 10 s so one hung request can't stall a large broadcast past the
// function's wall-clock limit. Best-effort: push failures must never fail the
// calling webhook. Projects with Enhanced Security for push must set the
// EXPO_ACCESS_TOKEN function secret. `fetchImpl`/`concurrency` are for tests.
export async function sendExpoPushBatch(
  messages: ExpoPushMessage[],
  opts: { fetchImpl?: typeof fetch; concurrency?: number } = {},
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const chunks: ExpoPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));
  await runPool(chunks, opts.concurrency ?? 4, (chunk) =>
    fetchImpl("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers,
      body: JSON.stringify(chunk.length === 1 ? chunk[0] : chunk),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {}),
  );
}

export async function sendExpoPush(message: ExpoPushMessage): Promise<void> {
  await sendExpoPushBatch([message]);
}
