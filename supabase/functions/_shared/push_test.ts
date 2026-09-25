import { assertEquals } from "jsr:@std/assert@1";
import { type ExpoPushMessage, sendExpoPushBatch } from "./push.ts";

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
