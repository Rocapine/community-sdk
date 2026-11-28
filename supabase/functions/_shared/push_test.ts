import { assertEquals } from "jsr:@std/assert@1";
import {
  type ExpoPushMessage,
  dropInvalidTokens,
  recipientTokens,
  sendExpoPushBatch,
  unreadBadge,
  unreadBadges,
} from "./push.ts";

const messages = (n: number): ExpoPushMessage[] =>
  Array.from({ length: n }, (_, i) => ({ to: `ExponentPushToken[${i}]`, title: "t", data: {} }));

/** Fake fetch: records each POST's message count and the peak number in flight. */
function fakeFetch(opts: { fail?: boolean } = {}) {
  const sizes: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    sizes.push(Array.isArray(body) ? body.length : 1);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    if (opts.fail) throw new Error("network down");
    return new Response("{}");
  };
  return { fetchImpl, sizes, peak: () => maxInFlight };
}

Deno.test("sendExpoPushBatch: chunks of 100", async () => {
  const f = fakeFetch();
  await sendExpoPushBatch(messages(250), { fetchImpl: f.fetchImpl });
  assertEquals(f.sizes, [100, 100, 50]);
});

Deno.test("sendExpoPushBatch: at most 4 requests in flight", async () => {
  const f = fakeFetch();
  await sendExpoPushBatch(messages(450), { fetchImpl: f.fetchImpl });
  assertEquals(f.sizes.length, 5);
  assertEquals(f.peak(), 4);
});

Deno.test("sendExpoPushBatch: a rejected fetch does not throw", async () => {
  const f = fakeFetch({ fail: true });
  await sendExpoPushBatch(messages(150), { fetchImpl: f.fetchImpl });
  assertEquals(f.sizes, [100, 50]);
});

Deno.test("sendExpoPushBatch: a rejected send is logged, not swallowed", async () => {
  const seen: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    seen.push(args.map(String).join(" "));
  };
  try {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ errors: [{ code: "UNAUTHORIZED" }] }), {
        status: 401,
      })) as unknown as typeof fetch;
    await sendExpoPushBatch(messages(1), { fetchImpl });
    const ticketError = (async () =>
      new Response(
        JSON.stringify({ data: [{ status: "error", message: "DeviceNotRegistered" }] }),
        { status: 200 },
      )) as unknown as typeof fetch;
    await sendExpoPushBatch(messages(1), { fetchImpl: ticketError });
  } finally {
    console.error = original;
  }
  assertEquals(seen.length, 2);
  assertEquals(seen[0].includes("401"), true);
  assertEquals(seen[1].includes("DeviceNotRegistered"), true);
});

Deno.test("unreadBadge: rows from a member blocked either way do not count", async () => {
  const supabase = fakeSupabase({
    notification_seen: null,
    notifications: [
      { id: "a", actor_id: "friend" },
      { id: "b", actor_id: "blocked" },
      { id: "c", actor_id: "blocker" },
      { id: "d", actor_id: null },
    ],
    notification_reads: [],
    blocks: [
      { blocker_id: "u1", blocked_id: "blocked" },
      { blocker_id: "blocker", blocked_id: "u1" },
    ],
  });
  assertEquals(await unreadBadge(supabase, "u1"), 2);
});

// A tiny chainable stand-in for the supabase-js query builder: each table
// resolves to fixed rows, or to a function of its `eq` filters.
type Rows = unknown | ((eq: Record<string, unknown>) => unknown);
function fakeSupabase(
  tables: Record<string, Rows>,
  rpcs: Record<string, { data: unknown; error: unknown }> = {},
) {
  return {
    rpc: (name: string) =>
      Promise.resolve(rpcs[name] ?? { data: null, error: { message: "no rpc" } }),
    from(table: string) {
      const eq: Record<string, unknown> = {};
      const result = () => {
        const t = tables[table];
        return { data: (typeof t === "function" ? t(eq) : t) ?? null, error: null };
      };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "neq", "gt", "in", "limit", "or"]) chain[m] = () => chain;
      chain.eq = (column: string, value: unknown) => {
        eq[column] = value;
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve(result());
      chain.then = (ok: (r: unknown) => unknown) => Promise.resolve(result()).then(ok);
      return chain;
    },
  };
}

Deno.test("unreadBadge: rows past the watermark minus the ones read one by one", async () => {
  const supabase = fakeSupabase({
    notification_seen: { seen_at: "2026-10-01T00:00:00Z" },
    notifications: [{ id: "a" }, { id: "b" }, { id: "c" }],
    notification_reads: [{ item_id: "b" }],
  });
  assertEquals(await unreadBadge(supabase, "u1"), 2);
});

Deno.test("unreadBadge: never below 1 while a push is being sent", async () => {
  const supabase = fakeSupabase({
    notification_seen: null,
    notifications: [{ id: "a" }],
    notification_reads: [{ item_id: "a" }],
  });
  assertEquals(await unreadBadge(supabase, "u1"), 1);
});

Deno.test("unreadBadge: admin posts sent to everyone count, like in the center", async () => {
  const supabase = fakeSupabase({
    notification_seen: null,
    notifications: [{ id: "a" }],
    posts: [{ id: "p1" }, { id: "p2" }],
    notification_reads: [{ item_id: "p2" }],
  });
  assertEquals(await unreadBadge(supabase, "u1"), 2);
});

Deno.test("unreadBadges: each member gets their own count, computed once", async () => {
  let seenReads = 0;
  const supabase = fakeSupabase({
    notification_seen: () => {
      seenReads++;
      return null;
    },
    notifications: (eq: Record<string, unknown>) =>
      eq.user_id === "u1" ? [{ id: "a" }, { id: "b" }] : [],
    posts: [{ id: "broadcast" }],
    notification_reads: [],
  });
  const badges = await unreadBadges(supabase, ["u1", "u2", "u1"]);
  assertEquals(Object.fromEntries(badges), { u1: 3, u2: 1 });
  assertEquals(seenReads, 2);
});

Deno.test("recipientTokens unions and dedupes", async () => {
  const supabase = fakeSupabase({
    push_devices: [{ expo_push_token: "T1" }, { expo_push_token: "T2" }],
    push_tokens: { expo_push_token: "T1", notify_likes: false, notify_comments: true },
  });
  const r = await recipientTokens(supabase, "u1");
  assertEquals(r.tokens.sort(), ["T1", "T2"]);
  assertEquals(r.prefs, { notify_likes: false, notify_comments: true });
});

Deno.test("prefs default to true without a push_tokens row", async () => {
  const supabase = fakeSupabase({ push_devices: [{ expo_push_token: "T1" }], push_tokens: null });
  const r = await recipientTokens(supabase, "u1");
  assertEquals(r.tokens, ["T1"]);
  assertEquals(r.prefs, { notify_likes: true, notify_comments: true });
});

Deno.test("DeviceNotRegistered tokens are returned", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        data: [
          { status: "ok", id: "x" },
          {
            status: "error",
            message: "gone",
            details: { error: "DeviceNotRegistered" },
          },
        ],
      }),
    )) as unknown as typeof fetch;
  const original = console.error;
  console.error = () => {};
  try {
    const out = await sendExpoPushBatch(
      [
        { to: "ok-token", title: "t", data: {} },
        { to: "dead-token", title: "t", data: {} },
      ],
      { fetchImpl },
    );
    assertEquals(out.invalidTokens, ["dead-token"]);
  } finally {
    console.error = original;
  }
});

Deno.test("a single message answers with an object, still handled", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        data: { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
      }),
    )) as unknown as typeof fetch;
  const original = console.error;
  console.error = () => {};
  try {
    const out = await sendExpoPushBatch([{ to: "dead", title: "t", data: {} }], { fetchImpl });
    assertEquals(out.invalidTokens, ["dead"]);
  } finally {
    console.error = original;
  }
});

Deno.test("dropInvalidTokens: only the given tokens, in chunks of 100", async () => {
  const calls: { table: string; op: string; tokens: string[] }[] = [];
  const supabase = {
    from: (table: string) => ({
      delete: () => ({
        in: (_c: string, tokens: string[]) => {
          calls.push({ table, op: "delete", tokens });
          return Promise.resolve({ error: null });
        },
      }),
      update: () => ({
        in: (_c: string, tokens: string[]) => {
          calls.push({ table, op: "update", tokens });
          return Promise.resolve({ error: { message: "boom" } });
        },
      }),
    }),
  };
  const original = console.error;
  console.error = () => {};
  try {
    await dropInvalidTokens(supabase, []);
    assertEquals(calls.length, 0);
    const tokens = Array.from({ length: 250 }, (_, i) => `t${i}`);
    await dropInvalidTokens(supabase, tokens);
  } finally {
    console.error = original;
  }
  assertEquals(
    calls.map((c) => `${c.table}:${c.op}:${c.tokens.length}`),
    [
      "push_devices:delete:100",
      "push_tokens:update:100",
      "push_devices:delete:100",
      "push_tokens:update:100",
      "push_devices:delete:50",
      "push_tokens:update:50",
    ],
  );
  assertEquals(calls.flatMap((c) => (c.op === "delete" ? c.tokens : [])).length, 250);
});

Deno.test("unreadBadge: adds the followed groups' unread messages to the inbox count", async () => {
  const tables = {
    notification_seen: null,
    notifications: [{ id: "a" }, { id: "b" }],
    notification_reads: [],
  };
  const ok = fakeSupabase(tables, { unread_followed_messages_for: { data: 3, error: null } });
  assertEquals(await unreadBadge(ok, "u1"), 5);
  // Inbox empty: the messages alone, not 1 + messages.
  const messagesOnly = fakeSupabase(
    { notification_seen: null, notifications: [], notification_reads: [] },
    { unread_followed_messages_for: { data: 4, error: null } },
  );
  assertEquals(await unreadBadge(messagesOnly, "u1"), 4);
});

Deno.test("unreadBadge: the inbox count alone when the messages RPC errors", async () => {
  const supabase = fakeSupabase(
    { notification_seen: null, notifications: [{ id: "a" }, { id: "b" }], notification_reads: [] },
    { unread_followed_messages_for: { data: null, error: { message: "does not exist" } } },
  );
  assertEquals(await unreadBadge(supabase, "u1"), 2);
});

Deno.test("unreadBadges: a missing messages RPC is called once per invocation", async () => {
  const supabase = fakeSupabase(
    { notification_seen: null, notifications: [{ id: "a" }], notification_reads: [] },
    { unread_followed_messages_for: { data: null, error: { code: "PGRST202", message: "x" } } },
  );
  let calls = 0;
  const rpc = supabase.rpc;
  supabase.rpc = (name: string) => {
    if (name === "unread_followed_messages_for") calls++;
    return rpc(name);
  };
  const badges = await unreadBadges(supabase, ["u1", "u2", "u3"], 1);
  assertEquals([...badges.values()], [1, 1, 1]);
  assertEquals(calls, 1);
});

Deno.test("unreadBadges: the missing messages RPC is probed once, even fanned out", async () => {
  const supabase = fakeSupabase(
    { notification_seen: null, notifications: [{ id: "a" }], notification_reads: [] },
    { unread_followed_messages_for: { data: null, error: { code: "42883", message: "x" } } },
  );
  let calls = 0;
  const rpc = supabase.rpc;
  supabase.rpc = (name: string) => {
    if (name === "unread_followed_messages_for") calls++;
    return rpc(name);
  };
  const uids = Array.from({ length: 50 }, (_, i) => `u${i}`);
  const badges = await unreadBadges(supabase, uids, 20);
  assertEquals(badges.size, 50);
  assertEquals(calls, 1);
});

Deno.test("unreadBadges: no recipients, no calls", async () => {
  const supabase = fakeSupabase({});
  assertEquals((await unreadBadges(supabase, [])).size, 0);
});

Deno.test("unreadBadges: a transient RPC error is retried for the next member", async () => {
  const supabase = fakeSupabase(
    { notification_seen: null, notifications: [], notification_reads: [] },
    { unread_followed_messages_for: { data: null, error: { code: "57014", message: "timeout" } } },
  );
  let calls = 0;
  const rpc = supabase.rpc;
  supabase.rpc = (name: string) => {
    if (name === "unread_followed_messages_for") calls++;
    return rpc(name);
  };
  await unreadBadges(supabase, ["u1", "u2"], 1);
  assertEquals(calls, 2);
});
